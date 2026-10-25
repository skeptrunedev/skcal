// Goal phases (bulk / cut / maintain): storage plus the progress math the
// dashboard, HTTP API, coach, and MCP tools share. The math functions are pure
// so they're unit-tested without the Worker.
import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Phase } from "../shared/types";

const DAY_MS = 86_400_000;
const LB_PER_KG = 2.2046226218;
// Energy in a kilogram of bodyweight change (the usual ~3500 kcal/lb rule).
const KCAL_PER_KG = 7700;

export const PHASE_KINDS = ["bulk", "cut", "maintain"] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

// Default planned rate (% bodyweight per week) when the caller gives none.
export const DEFAULT_RATE_PCT: Record<PhaseKind, number> = { bulk: 0.25, cut: -0.5, maintain: 0 };

type Env = { env: { DB: D1Database } };
const db = (c: Env) => drizzle(c.env.DB, { schema });
type PhaseRow = typeof schema.phases.$inferSelect;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Least-squares slope of weight (kg) per day; null with < 2 readings spanning a day. */
export function kgPerDaySlope(points: { t: number; kg: number }[]): number | null {
  if (points.length < 2 || points[points.length - 1].t - points[0].t < DAY_MS) return null;
  const mt = points.reduce((s, p) => s + p.t, 0) / points.length;
  const mk = points.reduce((s, p) => s + p.kg, 0) / points.length;
  const num = points.reduce((s, p) => s + (p.t - mt) * (p.kg - mk), 0);
  const den = points.reduce((s, p) => s + (p.t - mt) ** 2, 0);
  return den > 0 ? (num / den) * DAY_MS : null;
}

/**
 * Maintenance calories from the user's own data: average logged intake minus
 * the energy in the weight they gained (or plus what they lost) over the same
 * window. Needs 10+ logged days and a weight trend across 14+ days; otherwise
 * null and callers fall back to an equation (Mifflin-St Jeor in the coach).
 */
export function estimateTdee(
  intake: { date: string; kcal: number | null }[],
  weights: { t: number; kg: number }[],
): { kcal: number; days: number } | null {
  const logged = intake.filter((d) => d.kcal != null && d.kcal > 0);
  if (logged.length < 10 || weights.length < 2) return null;
  if (weights[weights.length - 1].t - weights[0].t < 14 * DAY_MS) return null;
  const slope = kgPerDaySlope(weights);
  if (slope == null) return null;
  const avg = logged.reduce((s, d) => s + (d.kcal ?? 0), 0) / logged.length;
  return { kcal: Math.round((avg - slope * KCAL_PER_KG) / 10) * 10, days: logged.length };
}

/** Daily kcal for a planned weekly rate on top of maintenance. */
export function kcalForRate(tdee: number, bodyweightKg: number, ratePctPerWeek: number): number {
  const kgPerWeek = (bodyweightKg * ratePctPerWeek) / 100;
  return Math.round((tdee + (kgPerWeek * KCAL_PER_KG) / 7) / 10) * 10;
}

/**
 * How the phase is tracking: planned vs actual weekly rate (least squares over
 * every weigh-in since the start). "on_track" is within a third of the planned
 * rate either side, or within ±0.15% / week for maintenance.
 */
export function phaseProgress(phase: PhaseRow, weights: { t: number; kg: number }[], today: string): Phase["progress"] {
  const end = phase.endedDate ?? today;
  const inRange = weights.filter((w) => w.t >= dayMs(phase.startDate) && w.t < dayMs(end) + DAY_MS);
  const startKg = phase.startWeightKg ?? inRange[0]?.kg ?? null;
  const latestKg = inRange.at(-1)?.kg ?? null;
  const weeksElapsed = round1(Math.max(0, (dayMs(end) - dayMs(phase.startDate)) / (7 * DAY_MS)));
  const weeksPlanned = phase.plannedEndDate ? round1((dayMs(phase.plannedEndDate) - dayMs(phase.startDate)) / (7 * DAY_MS)) : null;
  const slope = kgPerDaySlope(inRange);
  const actualKgPerWeek = slope != null && weeksElapsed >= 1 ? slope * 7 : null;
  const plannedKgPerWeek = startKg != null && phase.ratePctPerWeek != null ? (startKg * phase.ratePctPerWeek) / 100 : null;
  const actualPct = actualKgPerWeek != null && startKg ? (actualKgPerWeek / startKg) * 100 : null;

  let status: "on_track" | "too_fast" | "too_slow" | "not_enough_data" = "not_enough_data";
  if (actualPct != null && phase.ratePctPerWeek != null) {
    const planned = phase.ratePctPerWeek;
    const band = planned === 0 ? 0.15 : Math.abs(planned) / 3;
    const diff = actualPct - planned;
    if (Math.abs(diff) <= band) status = "on_track";
    else if (planned === 0) status = diff > 0 ? "too_fast" : "too_slow";
    // Faster in the planned direction is too fast; anything short of it is too slow.
    else status = Math.sign(diff) === Math.sign(planned) ? "too_fast" : "too_slow";
  }
  return {
    weeksElapsed,
    weeksPlanned,
    latestWeightLb: latestKg != null ? round1(latestKg * LB_PER_KG) : null,
    changeLb: latestKg != null && startKg != null ? round1((latestKg - startKg) * LB_PER_KG) : null,
    plannedLbPerWeek: plannedKgPerWeek != null ? round2(plannedKgPerWeek * LB_PER_KG) : null,
    actualLbPerWeek: actualKgPerWeek != null ? round2(actualKgPerWeek * LB_PER_KG) : null,
    actualPctPerWeek: actualPct != null ? round2(actualPct) : null,
    status,
  };
}

function phaseOut(p: PhaseRow): Omit<Phase, "progress"> {
  return {
    id: p.id,
    kind: p.kind,
    startDate: p.startDate,
    plannedEndDate: p.plannedEndDate,
    endedDate: p.endedDate,
    active: p.endedDate == null,
    startWeightLb: p.startWeightKg != null ? round1(p.startWeightKg * LB_PER_KG) : null,
    goalWeightLb: p.goalWeightKg != null ? round1(p.goalWeightKg * LB_PER_KG) : null,
    ratePctPerWeek: p.ratePctPerWeek,
    dailyKcalTarget: p.dailyKcalTarget,
    proteinTargetG: p.proteinTargetG,
    note: p.note,
  };
}
export type PhaseOut = Phase;

async function weightPoints(c: Env, email: string, sinceMs = 0) {
  const rows = await db(c)
    .select({ ts: schema.weightReadings.ts, kg: schema.weightReadings.weightKg })
    .from(schema.weightReadings)
    .where(and(eq(schema.weightReadings.userEmail, email), gte(schema.weightReadings.ts, new Date(sinceMs))))
    .orderBy(asc(schema.weightReadings.ts));
  return rows.map((r) => ({ t: r.ts.getTime(), kg: r.kg }));
}

/** Maintenance estimate over the last 28 days of the user's own logs. */
export async function tdeeForUser(c: Env, email: string, today: string) {
  const since = new Date(dayMs(today) - 28 * DAY_MS).toISOString().slice(0, 10);
  const intake = await db(c)
    .select({ date: schema.nutritionDays.date, kcal: schema.nutritionDays.kcal })
    .from(schema.nutritionDays)
    .where(and(eq(schema.nutritionDays.userEmail, email), gte(schema.nutritionDays.date, since)));
  // Today is usually half-logged; leave it out.
  return estimateTdee(
    intake.filter((d) => d.date < today),
    await weightPoints(c, email, dayMs(since)),
  );
}

export async function activePhase(c: Env, email: string) {
  return (
    await db(c)
      .select()
      .from(schema.phases)
      .where(and(eq(schema.phases.userEmail, email), isNull(schema.phases.endedDate)))
      .limit(1)
  )[0];
}

export async function listPhasesForUser(c: Env, email: string, today: string) {
  const rows = await db(c).select().from(schema.phases).where(eq(schema.phases.userEmail, email)).orderBy(desc(schema.phases.startDate));
  const weights = await weightPoints(c, email);
  const phases: PhaseOut[] = rows.map((p) => ({ ...phaseOut(p), progress: phaseProgress(p, weights, today) }));
  return { active: phases.find((p) => p.active) ?? null, phases, maintenance: await tdeeForUser(c, email, today) };
}

export type PhaseInput = {
  kind?: unknown;
  startDate?: unknown;
  plannedEndDate?: unknown;
  goalWeightLb?: unknown;
  ratePctPerWeek?: unknown;
  dailyKcal?: unknown;
  proteinG?: unknown;
  note?: unknown;
};

type Parsed = Partial<Omit<typeof schema.phases.$inferInsert, "id" | "userEmail">>;

// Validates the optional fields shared by start and update. Returns the
// column patch, or an error message.
function parseFields(input: PhaseInput): Parsed | { error: string } {
  const out: Parsed = {};
  if (input.startDate !== undefined) {
    if (!isDay(input.startDate)) return { error: "startDate must be YYYY-MM-DD" };
    out.startDate = input.startDate;
  }
  if (input.plannedEndDate !== undefined) {
    if (input.plannedEndDate !== null && input.plannedEndDate !== "" && !isDay(input.plannedEndDate))
      return { error: "plannedEndDate must be YYYY-MM-DD" };
    out.plannedEndDate = (input.plannedEndDate as string) || null;
  }
  if (input.goalWeightLb !== undefined && input.goalWeightLb !== null) {
    const lb = Number(input.goalWeightLb);
    if (!(lb >= 30 && lb <= 700)) return { error: "goalWeightLb must be 30-700" };
    out.goalWeightKg = lb / LB_PER_KG;
  }
  if (input.ratePctPerWeek !== undefined && input.ratePctPerWeek !== null) {
    const r = Number(input.ratePctPerWeek);
    if (!(r >= -2 && r <= 2)) return { error: "ratePctPerWeek must be between -2 and 2 (% bodyweight per week)" };
    out.ratePctPerWeek = r;
  }
  if (input.dailyKcal !== undefined && input.dailyKcal !== null) {
    const k = Number(input.dailyKcal);
    if (!(k >= 800 && k <= 6000)) return { error: "dailyKcal must be 800-6000" };
    out.dailyKcalTarget = Math.round(k);
  }
  if (input.proteinG !== undefined && input.proteinG !== null) {
    const p = Number(input.proteinG);
    if (!(p >= 30 && p <= 400)) return { error: "proteinG must be 30-400" };
    out.proteinTargetG = Math.round(p);
  }
  if (input.note !== undefined) out.note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
  return out;
}

// Mirror a phase's numbers into `targets`, the row every surface reads.
async function syncTargets(c: Env, email: string, p: PhaseRow) {
  const set: Partial<typeof schema.targets.$inferInsert> = {
    startDate: new Date(dayMs(p.startDate)),
    targetDate: p.plannedEndDate ? new Date(dayMs(p.plannedEndDate)) : null,
  };
  if (p.startWeightKg != null) set.startWeightKg = p.startWeightKg;
  if (p.goalWeightKg != null) set.goalWeightKg = p.goalWeightKg;
  if (p.dailyKcalTarget != null) set.dailyKcalTarget = p.dailyKcalTarget;
  if (p.proteinTargetG != null) set.proteinTargetG = p.proteinTargetG;
  await db(c).insert(schema.targets).values({ userEmail: email, ...set }).onConflictDoUpdate({ target: schema.targets.userEmail, set });
}

/**
 * Start a phase, closing any open one the day before. Fills in what the caller
 * left out: start weight = latest weigh-in, rate = the kind's default, goal
 * weight = start projected over the planned length, and daily kcal = data-driven
 * maintenance plus the rate's surplus or deficit (left unchanged when there
 * isn't enough logged data to estimate maintenance).
 */
export async function startPhaseForUser(c: Env, email: string, input: PhaseInput, today: string) {
  const kind = String(input.kind ?? "") as PhaseKind;
  if (!PHASE_KINDS.includes(kind)) return { error: "kind must be bulk, cut, or maintain" };
  const f = parseFields(input);
  if ("error" in f) return f;
  const startDate = f.startDate ?? today;
  if (f.plannedEndDate && f.plannedEndDate <= startDate) return { error: "plannedEndDate must be after startDate" };
  const rate = f.ratePctPerWeek ?? DEFAULT_RATE_PCT[kind];
  if ((kind === "bulk" && rate <= 0) || (kind === "cut" && rate >= 0))
    return { error: `a ${kind} needs a ${kind === "bulk" ? "positive" : "negative"} ratePctPerWeek` };

  const latest = (
    await db(c)
      .select({ kg: schema.weightReadings.weightKg })
      .from(schema.weightReadings)
      .where(eq(schema.weightReadings.userEmail, email))
      .orderBy(desc(schema.weightReadings.ts))
      .limit(1)
  )[0];
  const startKg = latest?.kg ?? null;
  let goalKg = f.goalWeightKg ?? null;
  if (goalKg == null && startKg != null && f.plannedEndDate) {
    const weeks = (dayMs(f.plannedEndDate) - dayMs(startDate)) / (7 * DAY_MS);
    goalKg = startKg * (1 + (rate / 100) * weeks);
  }
  let kcal = f.dailyKcalTarget ?? null;
  let kcalSource: "given" | "estimated" | "unchanged" = kcal != null ? "given" : "unchanged";
  const maintenance = await tdeeForUser(c, email, today);
  if (kcal == null && maintenance && startKg != null) {
    kcal = kcalForRate(maintenance.kcal, startKg, rate);
    kcalSource = "estimated";
  }

  const open = await activePhase(c, email);
  if (open) {
    const dayBefore = new Date(dayMs(startDate) - DAY_MS).toISOString().slice(0, 10);
    await db(c)
      .update(schema.phases)
      .set({ endedDate: dayBefore < open.startDate ? open.startDate : dayBefore })
      .where(eq(schema.phases.id, open.id));
  }
  const row = (
    await db(c)
      .insert(schema.phases)
      .values({
        id: crypto.randomUUID(),
        userEmail: email,
        kind,
        startDate,
        plannedEndDate: f.plannedEndDate ?? null,
        startWeightKg: startKg,
        goalWeightKg: goalKg,
        ratePctPerWeek: rate,
        dailyKcalTarget: kcal,
        proteinTargetG: f.proteinTargetG ?? null,
        note: f.note ?? null,
      })
      .returning()
  )[0];
  await syncTargets(c, email, row);
  return {
    ok: true as const,
    phase: { ...phaseOut(row), progress: phaseProgress(row, await weightPoints(c, email), today) },
    closedPhaseId: open?.id ?? null,
    kcalSource,
    maintenanceKcal: maintenance?.kcal ?? null,
  };
}

export async function updatePhaseForUser(c: Env, email: string, id: string, input: PhaseInput, today: string) {
  const row = (await db(c).select().from(schema.phases).where(and(eq(schema.phases.id, id), eq(schema.phases.userEmail, email))).limit(1))[0];
  if (!row) return { error: "no phase with that id" };
  if (input.kind !== undefined) return { error: "kind can't change, start a new phase instead" };
  const f = parseFields(input);
  if ("error" in f) return f;
  if (!Object.keys(f).length) return { error: "nothing to change" };
  const next = { ...row, ...f };
  if (next.plannedEndDate && next.plannedEndDate <= next.startDate) return { error: "plannedEndDate must be after startDate" };
  const updated = (await db(c).update(schema.phases).set(f).where(eq(schema.phases.id, id)).returning())[0];
  if (updated.endedDate == null) await syncTargets(c, email, updated);
  return { ok: true as const, phase: { ...phaseOut(updated), progress: phaseProgress(updated, await weightPoints(c, email), today) } };
}

export async function endPhaseForUser(c: Env, email: string, id: string, endDate: string) {
  const row = (await db(c).select().from(schema.phases).where(and(eq(schema.phases.id, id), eq(schema.phases.userEmail, email))).limit(1))[0];
  if (!row) return { error: "no phase with that id" };
  if (row.endedDate) return { error: "that phase already ended" };
  if (!isDay(endDate) || endDate < row.startDate) return { error: "end date must be YYYY-MM-DD on or after the start" };
  await db(c).update(schema.phases).set({ endedDate: endDate }).where(eq(schema.phases.id, id));
  return { ok: true as const, ended: id, endedDate: endDate };
}

export async function deletePhaseForUser(c: Env, email: string, id: string): Promise<boolean> {
  const owned = await db(c).select({ id: schema.phases.id }).from(schema.phases).where(and(eq(schema.phases.id, id), eq(schema.phases.userEmail, email))).limit(1);
  if (!owned.length) return false;
  await db(c).delete(schema.phases).where(eq(schema.phases.id, id));
  return true;
}

/** One line for agent grounding prompts. */
export function phaseLine(p: PhaseOut | null): string {
  if (!p) return "no goal phase set (assume a lean cut with a protein floor unless they say otherwise)";
  const pr = p.progress;
  const rate = p.ratePctPerWeek != null ? `${p.ratePctPerWeek > 0 ? "+" : ""}${p.ratePctPerWeek}% bodyweight/week planned` : "no planned rate";
  const parts = [
    `${p.kind.toUpperCase()} since ${p.startDate}${p.plannedEndDate ? ` until ${p.plannedEndDate}` : ""} (week ${Math.floor(pr.weeksElapsed) + 1}${pr.weeksPlanned ? ` of ${Math.ceil(pr.weeksPlanned)}` : ""})`,
    rate + (pr.plannedLbPerWeek != null ? ` (${pr.plannedLbPerWeek} lb/week)` : ""),
    pr.actualLbPerWeek != null ? `actual ${pr.actualLbPerWeek} lb/week, status ${pr.status}` : "not enough weigh-ins yet for an actual rate",
  ];
  if (pr.changeLb != null) parts.push(`${pr.changeLb > 0 ? "+" : ""}${pr.changeLb} lb since start`);
  if (p.goalWeightLb != null) parts.push(`goal ${p.goalWeightLb} lb`);
  return parts.join("; ") + ` [phase id ${p.id}]`;
}
