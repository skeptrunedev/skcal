// Mesocycle storage: every training operation the HTTP API, the coach tools,
// and the MCP server share, so all three surfaces behave identically. Results
// are plain JSON (weights in pounds); failures are { error } like the other
// *ForUser helpers. Programming math lives in ./training.
import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { BUILTIN_EXERCISES, MUSCLES, TEMPLATES } from "./training-data";
import {
  EQUIPMENT,
  FEEDBACK_SCALES,
  MAX_DAYS,
  MAX_WEEKS,
  MIN_DAYS,
  MIN_WEEKS,
  initialSetCounts,
  isDeload,
  isMuscle,
  muscleInfo,
  planNextWeek,
  rirForWeek,
  type Feedback,
  type FeedbackKey,
} from "./training";

type Env = { env: { DB: D1Database } };
const db = (c: Env) => drizzle(c.env.DB, { schema });
const MAX_ACTIVE = 1;

type Meso = typeof schema.mesocycles.$inferSelect;
type Day = typeof schema.mesoDays.$inferSelect;
type Slot = typeof schema.mesoSlots.$inferSelect;
type SetRow = typeof schema.mesoSets.$inferSelect;
type FeedbackRow = typeof schema.mesoFeedback.$inferSelect;

export type ExerciseOut = { id: string; name: string; muscle: string; equipment: string; videoUrl: string | null; custom: boolean };

// ---- exercise library ------------------------------------------------------

export async function listExercisesForUser(c: Env, email: string, muscle?: string): Promise<ExerciseOut[]> {
  const custom = await db(c).select().from(schema.exercises).where(eq(schema.exercises.userEmail, email)).orderBy(asc(schema.exercises.name));
  const all: ExerciseOut[] = [
    ...BUILTIN_EXERCISES.map((e) => ({ id: e.id, name: e.name, muscle: e.muscle, equipment: e.equipment, videoUrl: e.videoUrl ?? null, custom: false })),
    ...custom.map((e) => ({ id: e.id, name: e.name, muscle: e.muscle, equipment: e.equipment, videoUrl: e.videoUrl, custom: true })),
  ];
  return muscle ? all.filter((e) => e.muscle === muscle) : all;
}

async function findExercise(c: Env, email: string, id: string): Promise<ExerciseOut | null> {
  const b = BUILTIN_EXERCISES.find((e) => e.id === id);
  if (b) return { id: b.id, name: b.name, muscle: b.muscle, equipment: b.equipment, videoUrl: b.videoUrl ?? null, custom: false };
  const row = (await db(c).select().from(schema.exercises).where(and(eq(schema.exercises.id, id), eq(schema.exercises.userEmail, email))).limit(1))[0];
  return row ? { id: row.id, name: row.name, muscle: row.muscle, equipment: row.equipment, videoUrl: row.videoUrl, custom: true } : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Resolve an exercise by id, else by name: exact (case/punctuation-blind),
 * then the best word-overlap match within the muscle when one is given.
 */
export async function resolveExercise(c: Env, email: string, ref: { id?: unknown; name?: unknown; muscle?: unknown }) {
  if (typeof ref.id === "string" && ref.id) {
    const byId = await findExercise(c, email, ref.id);
    if (byId || ref.name == null) return byId;
  }
  if (typeof ref.name !== "string" || !ref.name.trim()) return null;
  const pool = await listExercisesForUser(c, email, isMuscle(ref.muscle) ? ref.muscle : undefined);
  const want = norm(ref.name);
  const exact = pool.find((e) => norm(e.name) === want);
  if (exact) return exact;
  const words = new Set(want.split(" "));
  let best: ExerciseOut | null = null;
  let bestScore = 0;
  for (const e of pool) {
    const ew = norm(e.name).split(" ");
    const hits = ew.filter((w) => words.has(w)).length;
    const score = hits / Math.max(ew.length, words.size);
    if (score > bestScore) [best, bestScore] = [e, score];
  }
  return bestScore >= 0.5 ? best : null;
}

export async function createExerciseForUser(c: Env, email: string, input: { name?: unknown; muscle?: unknown; equipment?: unknown; videoUrl?: unknown }) {
  const name = String(input.name ?? "").trim().slice(0, 100);
  if (!name) return { error: "name required" };
  if (!isMuscle(input.muscle)) return { error: `muscle must be one of ${MUSCLES.map((m) => m.key).join(", ")}` };
  const equipment = String(input.equipment ?? "other");
  if (!(EQUIPMENT as readonly string[]).includes(equipment)) return { error: `equipment must be one of ${EQUIPMENT.join(", ")}` };
  const videoUrl = typeof input.videoUrl === "string" && /^https:\/\//.test(input.videoUrl) ? input.videoUrl.slice(0, 500) : null;
  const row = (
    await db(c)
      .insert(schema.exercises)
      .values({ id: `c_${crypto.randomUUID()}`, userEmail: email, name, muscle: input.muscle, equipment, videoUrl })
      .returning()
  )[0];
  return { ok: true as const, exercise: { id: row.id, name: row.name, muscle: row.muscle, equipment: row.equipment, videoUrl: row.videoUrl, custom: true } };
}

export async function deleteExerciseForUser(c: Env, email: string, id: string): Promise<boolean> {
  const owned = await db(c).select({ id: schema.exercises.id }).from(schema.exercises).where(and(eq(schema.exercises.id, id), eq(schema.exercises.userEmail, email))).limit(1);
  if (!owned.length) return false;
  await db(c).delete(schema.exercises).where(eq(schema.exercises.id, id));
  return true;
}

// ---- creating a mesocycle --------------------------------------------------

export type MesoCreateInput = {
  name?: unknown;
  weeks?: unknown;
  startDate?: unknown;
  template?: unknown;
  days?: unknown; // [{ label?, slots: [{ muscle, exerciseId?, exerciseName? }] }]
  notes?: unknown;
};

type DayPlan = { label: string | null; slots: { muscle: string; exercise: ExerciseOut }[] };

// Default exercise for a muscle: the first library entry for it that isn't
// already used on the same day, so a day with two chest slots gets two moves.
function defaultExercise(pool: ExerciseOut[], muscle: string, used: Set<string>): ExerciseOut | null {
  const forMuscle = pool.filter((e) => e.muscle === muscle);
  return forMuscle.find((e) => !used.has(e.id)) ?? forMuscle[0] ?? null;
}

async function resolveDays(c: Env, email: string, input: MesoCreateInput): Promise<DayPlan[] | { error: string }> {
  const pool = await listExercisesForUser(c, email);
  let raw: { label?: unknown; slots?: unknown }[];
  if (typeof input.template === "string" && input.template) {
    const t = TEMPLATES.find((x) => x.key === input.template);
    if (!t) return { error: `unknown template, use one of ${TEMPLATES.map((x) => x.key).join(", ")}` };
    raw = t.days.map((d) => ({ label: d.label, slots: d.muscles.map((m) => ({ muscle: m })) }));
    // Explicit days override the template's (e.g. the template plus swaps).
    if (Array.isArray(input.days) && input.days.length) raw = input.days as typeof raw;
  } else if (Array.isArray(input.days)) {
    raw = input.days as typeof raw;
  } else {
    return { error: "pass a template or days" };
  }
  if (raw.length < MIN_DAYS || raw.length > MAX_DAYS) return { error: `days per week must be ${MIN_DAYS}-${MAX_DAYS}` };
  const out: DayPlan[] = [];
  for (const [i, d] of raw.entries()) {
    const slotsIn = Array.isArray(d?.slots) ? (d.slots as Record<string, unknown>[]) : [];
    if (!slotsIn.length || slotsIn.length > 12) return { error: `day ${i + 1} needs 1-12 exercise slots` };
    const used = new Set<string>();
    const slots: DayPlan["slots"] = [];
    for (const s of slotsIn) {
      const muscle = s.muscle;
      if (!isMuscle(muscle)) return { error: `day ${i + 1}: unknown muscle '${String(muscle)}'` };
      let ex: ExerciseOut | null = null;
      if (s.exerciseId || s.exerciseName) {
        ex = await resolveExercise(c, email, { id: s.exerciseId, name: s.exerciseName, muscle });
        if (!ex) return { error: `day ${i + 1}: no exercise matching '${String(s.exerciseId ?? s.exerciseName)}' for ${muscle}` };
      } else {
        ex = defaultExercise(pool, muscle, used);
        if (!ex) return { error: `no exercises in the library for ${muscle}` };
      }
      used.add(ex.id);
      slots.push({ muscle, exercise: ex });
    }
    out.push({ label: typeof d.label === "string" && d.label.trim() ? d.label.trim().slice(0, 40) : null, slots });
  }
  return out;
}

export async function createMesocycleForUser(c: Env, email: string, input: MesoCreateInput, today: string) {
  const weeks = Number(input.weeks ?? 5);
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKS || weeks > MAX_WEEKS)
    return { error: `weeks must be ${MIN_WEEKS}-${MAX_WEEKS} (including the final deload week)` };
  const startDate = input.startDate == null || input.startDate === "" ? today : String(input.startDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: "startDate must be YYYY-MM-DD" };
  const days = await resolveDays(c, email, input);
  if ("error" in days) return days;
  const template = TEMPLATES.find((t) => t.key === input.template);
  const name = String(input.name ?? "").trim().slice(0, 80) || template?.name || `${days.length}-day mesocycle`;

  const active = await db(c)
    .select({ id: schema.mesocycles.id })
    .from(schema.mesocycles)
    .where(and(eq(schema.mesocycles.userEmail, email), eq(schema.mesocycles.status, "active")));
  if (active.length >= MAX_ACTIVE) return { error: "a mesocycle is already active, finish or end it first", activeMesoId: active[0].id };

  const mesoId = crypto.randomUUID();
  const dayRows: (typeof schema.mesoDays.$inferInsert)[] = [];
  const slotRows: (typeof schema.mesoSlots.$inferInsert)[] = [];
  days.forEach((d, i) => {
    const dayId = crypto.randomUUID();
    dayRows.push({ id: dayId, mesoId, userEmail: email, position: i + 1, label: d.label });
    d.slots.forEach((s, j) =>
      slotRows.push({
        id: crypto.randomUUID(),
        mesoId,
        dayId,
        userEmail: email,
        position: j + 1,
        muscle: s.muscle,
        exerciseId: s.exercise.id,
        exerciseName: s.exercise.name,
        equipment: s.exercise.equipment,
      }),
    );
  });
  const counts = initialSetCounts(slotRows.map((s) => ({ id: s.id!, muscle: s.muscle })));
  const rir = rirForWeek(1, weeks);
  const setRows: (typeof schema.mesoSets.$inferInsert)[] = [];
  for (const s of slotRows) {
    const reps = muscleInfo(s.muscle)?.defaultReps ?? 10;
    for (let k = 1; k <= (counts.get(s.id!) ?? 2); k++)
      setRows.push(newSet(s as Slot, 1, k, { targetReps: reps, targetWeightLb: null }, rir));
  }

  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null;
  const d = db(c);
  // One batch = one transaction, so a half-written mesocycle never exists.
  await d.batch([
    d.insert(schema.mesocycles).values({ id: mesoId, userEmail: email, name, weeks, daysPerWeek: days.length, startDate, notes }),
    ...chunk(dayRows).map((r) => d.insert(schema.mesoDays).values(r)),
    ...chunk(slotRows).map((r) => d.insert(schema.mesoSlots).values(r)),
    ...chunk(setRows).map((r) => d.insert(schema.mesoSets).values(r)),
  ]);
  return { ok: true as const, mesocycle: await getMesocycleForUser(c, email, mesoId) };
}

// D1 caps a statement at 100 bound parameters; each set row binds 15.
function chunk<T>(rows: T[], size = 6): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function newSet(s: Slot, week: number, position: number, t: { targetReps: number | null; targetWeightLb: number | null }, rir: number | null) {
  return {
    id: crypto.randomUUID(),
    mesoId: s.mesoId,
    dayId: s.dayId,
    slotId: s.id,
    userEmail: s.userEmail,
    week,
    position,
    muscle: s.muscle,
    exerciseName: s.exerciseName,
    targetReps: t.targetReps,
    targetWeightLb: t.targetWeightLb,
    targetRir: rir,
  } satisfies typeof schema.mesoSets.$inferInsert;
}

// ---- reading ---------------------------------------------------------------

async function loadMeso(c: Env, email: string, id: string) {
  const meso = (await db(c).select().from(schema.mesocycles).where(and(eq(schema.mesocycles.id, id), eq(schema.mesocycles.userEmail, email))).limit(1))[0];
  if (!meso) return null;
  const [days, slots, sets, feedback, sessions] = await Promise.all([
    db(c).select().from(schema.mesoDays).where(eq(schema.mesoDays.mesoId, id)).orderBy(asc(schema.mesoDays.position)),
    db(c).select().from(schema.mesoSlots).where(eq(schema.mesoSlots.mesoId, id)).orderBy(asc(schema.mesoSlots.position)),
    db(c).select().from(schema.mesoSets).where(eq(schema.mesoSets.mesoId, id)).orderBy(asc(schema.mesoSets.week), asc(schema.mesoSets.position)),
    db(c).select().from(schema.mesoFeedback).where(eq(schema.mesoFeedback.mesoId, id)),
    db(c).select().from(schema.mesoSessions).where(eq(schema.mesoSessions.mesoId, id)),
  ]);
  return { meso, days, slots, sets, feedback, sessions };
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadMeso>>>;

const setOut = (s: SetRow) => ({
  id: s.id,
  position: s.position,
  targetReps: s.targetReps,
  targetWeightLb: s.targetWeightLb,
  targetRir: s.targetRir,
  weightLb: s.weightLb,
  reps: s.reps,
  done: s.loggedAt != null,
  loggedAt: s.loggedAt ? s.loggedAt.getTime() : null,
});

const feedbackOut = (f: FeedbackRow | undefined) =>
  f ? { soreness: f.soreness, pump: f.pump, jointPain: f.jointPain, workload: f.workload } : { soreness: null, pump: null, jointPain: null, workload: null };

/** The first (week, day) in order that isn't completed; null when all are. */
function nextSession(L: Loaded): { week: number; day: Day } | null {
  const done = new Set(L.sessions.map((s) => `${s.week}:${s.dayId}`));
  for (let w = 1; w <= L.meso.weeks; w++) for (const d of L.days) if (!done.has(`${w}:${d.id}`)) return { week: w, day: d };
  return null;
}

function mesoSummary(L: Loaded) {
  const next = nextSession(L);
  const done = new Set(L.sessions.map((s) => `${s.week}:${s.dayId}`));
  const muscles = [...new Set(L.slots.map((s) => s.muscle))];
  return {
    id: L.meso.id,
    name: L.meso.name,
    weeks: L.meso.weeks,
    daysPerWeek: L.meso.daysPerWeek,
    startDate: L.meso.startDate,
    status: L.meso.status,
    endedDate: L.meso.endedDate,
    notes: L.meso.notes,
    sessionsDone: L.sessions.length,
    sessionsTotal: L.meso.weeks * L.days.length,
    next: next ? { week: next.week, day: next.day.position, label: next.day.label } : null,
    muscles,
    // The calendar grid: one cell per (week, day) like RP's meso overview.
    calendar: Array.from({ length: L.meso.weeks }, (_, i) => ({
      week: i + 1,
      rir: rirForWeek(i + 1, L.meso.weeks),
      deload: isDeload(i + 1, L.meso.weeks),
      days: L.days.map((d) => ({ day: d.position, label: d.label, done: done.has(`${i + 1}:${d.id}`) })),
    })),
  };
}

export async function listMesocyclesForUser(c: Env, email: string) {
  const rows = await db(c).select().from(schema.mesocycles).where(eq(schema.mesocycles.userEmail, email)).orderBy(desc(schema.mesocycles.createdAt));
  const out = [];
  for (const m of rows) {
    const L = await loadMeso(c, email, m.id);
    if (L) out.push(mesoSummary(L));
  }
  return { mesocycles: out, active: out.find((m) => m.status === "active") ?? null };
}

/** Full mesocycle: summary, the day plans, and weekly volume per muscle. */
export async function getMesocycleForUser(c: Env, email: string, id: string) {
  const L = await loadMeso(c, email, id);
  if (!L) return null;
  const volume: Record<string, number[]> = {};
  for (const m of new Set(L.slots.map((s) => s.muscle))) {
    volume[m] = Array.from({ length: L.meso.weeks }, (_, i) => L.sets.filter((s) => s.muscle === m && s.week === i + 1).length);
  }
  return {
    ...mesoSummary(L),
    days: L.days.map((d) => ({
      id: d.id,
      day: d.position,
      label: d.label,
      slots: L.slots.filter((s) => s.dayId === d.id).map((s) => ({ id: s.id, muscle: s.muscle, exerciseId: s.exerciseId, exerciseName: s.exerciseName, equipment: s.equipment })),
    })),
    // Weeks get planned a day at a time as sessions finish; a week's totals
    // are only final once every day in it has sets.
    weekPlanned: Array.from({ length: L.meso.weeks }, (_, i) => L.days.every((d) => L.sets.some((s) => s.week === i + 1 && s.dayId === d.id))),
    // Planned sets per muscle per week, next to its landmarks.
    volume: Object.entries(volume).map(([m, sets]) => {
      const info = muscleInfo(m);
      return { muscle: m, label: info?.label ?? m, mev: info?.mev ?? null, mav: info ? [info.mavLow, info.mavHigh] : null, mrv: info?.mrv ?? null, setsByWeek: sets };
    }),
  };
}

/**
 * Make sure a session's sets exist. Week 1 is created with the mesocycle; a
 * later week is planned from the previous week's same day (whether or not that
 * session was formally completed), so jumping ahead never shows an empty day.
 */
async function ensureWeek(c: Env, L: Loaded, week: number, day: Day): Promise<boolean> {
  if (L.sets.some((s) => s.week === week && s.dayId === day.id)) return false;
  if (week <= 1) return false;
  const prevWeek = week - 1;
  if (!L.sets.some((s) => s.week === prevWeek && s.dayId === day.id)) await ensureWeek(c, L, prevWeek, day);
  const daySlots = L.slots.filter((s) => s.dayId === day.id);
  const plan = planNextWeek(
    daySlots.map((s) => ({
      slotId: s.id,
      muscle: s.muscle,
      equipment: s.equipment,
      sets: L.sets.filter((x) => x.slotId === s.id && x.week === prevWeek),
    })),
    new Map(L.feedback.filter((f) => f.week === prevWeek && f.dayId === day.id).map((f) => [f.muscle, feedbackOut(f) as Feedback])),
    weekVolume(L, prevWeek),
    week,
    L.meso.weeks,
  );
  const rir = rirForWeek(week, L.meso.weeks);
  const rows = daySlots.flatMap((s) => (plan.get(s.id) ?? []).map((t, i) => newSet(s, week, i + 1, t, rir)));
  if (!rows.length) return false;
  const inserted: SetRow[] = [];
  for (const part of chunk(rows)) inserted.push(...(await db(c).insert(schema.mesoSets).values(part).returning()));
  L.sets.push(...inserted);
  return true;
}

function weekVolume(L: Loaded, week: number) {
  const v = new Map<string, number>();
  for (const s of L.sets) if (s.week === week) v.set(s.muscle, (v.get(s.muscle) ?? 0) + 1);
  return v;
}

function sessionOut(L: Loaded, week: number, day: Day) {
  const done = L.sessions.find((s) => s.week === week && s.dayId === day.id);
  const slots = L.slots.filter((s) => s.dayId === day.id);
  const muscles = [...new Set(slots.map((s) => s.muscle))];
  return {
    meso: { id: L.meso.id, name: L.meso.name, weeks: L.meso.weeks, daysPerWeek: L.meso.daysPerWeek, status: L.meso.status },
    week,
    day: day.position,
    dayId: day.id,
    label: day.label,
    targetRir: rirForWeek(week, L.meso.weeks),
    deload: isDeload(week, L.meso.weeks),
    completed: !!done,
    completedAt: done ? done.completedAt.getTime() : null,
    exercises: slots.map((s) => {
      const prev = L.sets.filter((x) => x.slotId === s.id && x.week === week - 1);
      return {
        slotId: s.id,
        muscle: s.muscle,
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        equipment: s.equipment,
        sets: L.sets.filter((x) => x.slotId === s.id && x.week === week).map(setOut),
        // What they did last week on this slot, for the "last time" hint.
        lastWeek: prev.filter((x) => x.loggedAt).map((x) => ({ weightLb: x.weightLb, reps: x.reps })),
      };
    }),
    feedback: muscles.map((m) => ({
      muscle: m,
      ...feedbackOut(L.feedback.find((f) => f.week === week && f.dayId === day.id && f.muscle === m)),
      // Soreness asks about recovery since the muscle was last trained, so it
      // only applies once it has been: any earlier week, or an earlier day.
      askSoreness: week > 1 || L.slots.some((s) => s.muscle === m && (L.days.find((d) => d.id === s.dayId)?.position ?? 0) < day.position),
    })),
    feedbackScales: FEEDBACK_SCALES,
  };
}
export type SessionOut = ReturnType<typeof sessionOut>;

/** A session by week + day number (1-based); defaults to the next one due. */
export async function getSessionForUser(c: Env, email: string, mesoId: string, week?: number, dayPos?: number) {
  const L = await loadMeso(c, email, mesoId);
  if (!L) return { error: "no mesocycle with that id" };
  let w = week;
  let day = dayPos != null ? L.days.find((d) => d.position === dayPos) : undefined;
  if (w == null || !day) {
    const next = nextSession(L);
    if (!next) {
      w = L.meso.weeks;
      day = L.days[L.days.length - 1];
    } else {
      w ??= next.week;
      day ??= next.day;
    }
  }
  if (!day || w < 1 || w > L.meso.weeks) return { error: "no such week/day in this mesocycle" };
  await ensureWeek(c, L, w, day);
  return sessionOut(L, w, day);
}

async function activeMesoId(c: Env, email: string): Promise<string | null> {
  const row = (
    await db(c)
      .select({ id: schema.mesocycles.id })
      .from(schema.mesocycles)
      .where(and(eq(schema.mesocycles.userEmail, email), eq(schema.mesocycles.status, "active")))
      .orderBy(desc(schema.mesocycles.createdAt))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

/** The active mesocycle's next session (what "today's workout" means). */
export async function currentSessionForUser(c: Env, email: string) {
  const id = await activeMesoId(c, email);
  if (!id) return { active: false as const };
  const s = await getSessionForUser(c, email, id);
  return "error" in s ? { active: false as const } : { active: true as const, session: s };
}

// ---- logging -----------------------------------------------------------------

async function ownedSet(c: Env, email: string, id: string) {
  return (await db(c).select().from(schema.mesoSets).where(and(eq(schema.mesoSets.id, id), eq(schema.mesoSets.userEmail, email))).limit(1))[0];
}

export type SetPatch = { weightLb?: unknown; reps?: unknown; done?: unknown; targetReps?: unknown; targetWeightLb?: unknown };

function parseSetPatch(p: SetPatch): Partial<typeof schema.mesoSets.$inferInsert> | { error: string } {
  const out: Partial<typeof schema.mesoSets.$inferInsert> = {};
  const num = (v: unknown, lo: number, hi: number, field: string) => {
    if (v === null) return null;
    const n = Number(v);
    if (!(n >= lo && n <= hi)) throw new Error(`${field} must be ${lo}-${hi}`);
    return n;
  };
  try {
    if (p.weightLb !== undefined) out.weightLb = num(p.weightLb, 0, 2000, "weightLb");
    if (p.reps !== undefined) {
      const r = num(p.reps, 0, 100, "reps");
      out.reps = r == null ? null : Math.round(r);
    }
    if (p.targetWeightLb !== undefined) out.targetWeightLb = num(p.targetWeightLb, 0, 2000, "targetWeightLb");
    if (p.targetReps !== undefined) {
      const r = num(p.targetReps, 1, 100, "targetReps");
      out.targetReps = r == null ? null : Math.round(r);
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return out;
}

/**
 * Edit or log one set. Logging (done: true, or giving weight + reps without a
 * done flag) stamps logged_at; done: false clears it but keeps the numbers.
 */
export async function updateSetForUser(c: Env, email: string, id: string, patch: SetPatch) {
  const row = await ownedSet(c, email, id);
  if (!row) return { error: "no set with that id" };
  const f = parseSetPatch(patch);
  if ("error" in f) return f;
  const next = { ...row, ...f };
  if (patch.done === true || (patch.done === undefined && f.reps != null && next.weightLb != null)) {
    if (next.reps == null) return { error: "reps required to log a set" };
    if (next.weightLb == null) next.weightLb = 0;
    f.weightLb = next.weightLb;
    f.loggedAt = new Date();
  } else if (patch.done === false) {
    f.loggedAt = null;
  }
  if (!Object.keys(f).length) return { error: "nothing to change" };
  const updated = (await db(c).update(schema.mesoSets).set(f).where(eq(schema.mesoSets.id, id)).returning())[0];
  return { ok: true as const, set: setOut(updated) };
}

/** Add a set to a slot for a week, copying the last set's targets. */
export async function addSetForUser(c: Env, email: string, slotId: string, week: number) {
  const slot = (await db(c).select().from(schema.mesoSlots).where(and(eq(schema.mesoSlots.id, slotId), eq(schema.mesoSlots.userEmail, email))).limit(1))[0];
  if (!slot) return { error: "no slot with that id" };
  const meso = (await db(c).select().from(schema.mesocycles).where(eq(schema.mesocycles.id, slot.mesoId)).limit(1))[0];
  if (!(week >= 1 && week <= meso.weeks)) return { error: "week out of range" };
  const sets = await db(c)
    .select()
    .from(schema.mesoSets)
    .where(and(eq(schema.mesoSets.slotId, slotId), eq(schema.mesoSets.week, week)))
    .orderBy(asc(schema.mesoSets.position));
  if (sets.length >= 12) return { error: "12 sets per exercise is the max" };
  const last = sets.at(-1);
  const row = (
    await db(c)
      .insert(schema.mesoSets)
      .values(newSet(slot, week, (last?.position ?? 0) + 1, { targetReps: last?.targetReps ?? muscleInfo(slot.muscle)?.defaultReps ?? 10, targetWeightLb: last?.targetWeightLb ?? null }, rirForWeek(week, meso.weeks)))
      .returning()
  )[0];
  return { ok: true as const, set: setOut(row) };
}

export async function deleteSetForUser(c: Env, email: string, id: string): Promise<boolean> {
  const row = await ownedSet(c, email, id);
  if (!row) return false;
  await db(c).delete(schema.mesoSets).where(eq(schema.mesoSets.id, id));
  return true;
}

/**
 * Log sets by exercise for the agent surfaces ("bench 185x8, 185x8, 180x7"):
 * finds the slot in the target session (default: the next one due) by
 * exercise name or muscle, fills its unlogged sets in order, and appends sets
 * when more were done than planned.
 */
export async function logSetsForUser(
  c: Env,
  email: string,
  input: { exercise?: unknown; slotId?: unknown; sets?: unknown; week?: unknown; day?: unknown; mesoId?: unknown },
) {
  const mesoId = typeof input.mesoId === "string" && input.mesoId ? input.mesoId : await activeMesoId(c, email);
  if (!mesoId) return { error: "no active mesocycle, use log_workout for one-off training" };
  const session = await getSessionForUser(c, email, mesoId, input.week != null ? Number(input.week) : undefined, input.day != null ? Number(input.day) : undefined);
  if ("error" in session) return session;
  const raw = Array.isArray(input.sets) ? (input.sets as { weight_lb?: unknown; weightLb?: unknown; reps?: unknown }[]) : [];
  if (!raw.length || raw.length > 12) return { error: "sets must list 1-12 {weight_lb, reps}" };

  let ex = session.exercises.find((e) => e.slotId === input.slotId);
  if (!ex && typeof input.exercise === "string" && input.exercise.trim()) {
    const want = norm(input.exercise);
    ex =
      session.exercises.find((e) => norm(e.exerciseName) === want) ??
      session.exercises.find((e) => norm(e.exerciseName).includes(want) || want.includes(norm(e.exerciseName))) ??
      session.exercises.find((e) => e.muscle === want.replace(/ /g, "_"));
    if (!ex) {
      const words = want.split(" ");
      ex = session.exercises
        .map((e) => ({ e, hits: norm(e.exerciseName).split(" ").filter((w) => words.includes(w)).length }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)[0]?.e;
    }
  }
  if (!ex) {
    return {
      error: "no matching exercise in that session",
      session: { week: session.week, day: session.day, exercises: session.exercises.map((e) => ({ slotId: e.slotId, exerciseName: e.exerciseName, muscle: e.muscle })) },
    };
  }
  const open = ex.sets.filter((s) => !s.done);
  const logged = [];
  for (const [i, r] of raw.entries()) {
    const patch = { weightLb: r.weight_lb ?? r.weightLb ?? 0, reps: r.reps, done: true };
    let res;
    if (open[i]) res = await updateSetForUser(c, email, open[i].id, patch);
    else {
      const added = await addSetForUser(c, email, ex.slotId, session.week);
      if ("error" in added) return added;
      res = await updateSetForUser(c, email, added.set.id, patch);
    }
    if ("error" in res) return res;
    logged.push(res.set);
  }
  return { ok: true as const, week: session.week, day: session.day, exerciseName: ex.exerciseName, muscle: ex.muscle, logged };
}

export async function setFeedbackForUser(
  c: Env,
  email: string,
  mesoId: string,
  input: { week?: unknown; day?: unknown; muscle?: unknown } & Partial<Record<FeedbackKey, unknown>>,
) {
  const L = await loadMeso(c, email, mesoId);
  if (!L) return { error: "no mesocycle with that id" };
  const week = Number(input.week);
  const day = L.days.find((d) => d.position === Number(input.day));
  if (!day || !(week >= 1 && week <= L.meso.weeks)) return { error: "no such week/day in this mesocycle" };
  if (!isMuscle(input.muscle) || !L.slots.some((s) => s.dayId === day.id && s.muscle === input.muscle))
    return { error: "that muscle isn't trained on that day" };
  const vals: Partial<Record<FeedbackKey, number | null>> = {};
  for (const k of Object.keys(FEEDBACK_SCALES) as FeedbackKey[]) {
    const v = input[k];
    if (v === undefined) continue;
    if (v === null) {
      vals[k] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= FEEDBACK_SCALES[k].length)
      return { error: `${k} must be 0-${FEEDBACK_SCALES[k].length - 1} (${FEEDBACK_SCALES[k].join(" / ")})` };
    vals[k] = n;
  }
  if (!Object.keys(vals).length) return { error: "give at least one of soreness, pump, jointPain, workload" };
  await db(c)
    .insert(schema.mesoFeedback)
    .values({ mesoId, dayId: day.id, week, muscle: input.muscle, userEmail: email, ...vals })
    .onConflictDoUpdate({ target: [schema.mesoFeedback.mesoId, schema.mesoFeedback.dayId, schema.mesoFeedback.week, schema.mesoFeedback.muscle], set: vals });
  return { ok: true as const, week, day: day.position, muscle: input.muscle, ...vals };
}

/**
 * Finish a session: record it, log it as a regular workout (so Today's
 * workout log and every agent see it), and plan next week's same day from
 * this week's results and feedback. The last session completes the meso.
 */
export async function completeSessionForUser(c: Env, email: string, mesoId: string, week: number, dayPos: number) {
  const L = await loadMeso(c, email, mesoId);
  if (!L) return { error: "no mesocycle with that id" };
  const day = L.days.find((d) => d.position === dayPos);
  if (!day || !(week >= 1 && week <= L.meso.weeks)) return { error: "no such week/day in this mesocycle" };
  if (L.sessions.some((s) => s.week === week && s.dayId === day.id)) return { error: "that session is already complete" };
  await ensureWeek(c, L, week, day);

  const slots = L.slots.filter((s) => s.dayId === day.id);
  const doneSets = L.sets.filter((s) => s.week === week && s.dayId === day.id && s.loggedAt);
  const details = slots
    .map((s) => {
      const sets = doneSets.filter((x) => x.slotId === s.id);
      if (!sets.length) return null;
      return {
        exercise: s.exerciseName,
        sets: sets.length,
        reps: sets[0].reps,
        weight_lb: sets[0].weightLb,
        duration_s: null,
        distance_m: null,
        notes: sets.map((x) => `${x.weightLb ?? 0}x${x.reps ?? 0}`).join(", "),
      };
    })
    .filter((d) => d != null);
  const title = `${L.meso.name} · week ${week} day ${dayPos}${day.label ? ` (${day.label})` : ""}`;
  const workoutId = crypto.randomUUID();
  await db(c)
    .insert(schema.workouts)
    .values({
      id: workoutId,
      userEmail: email,
      source: "manual",
      externalId: `meso:${mesoId}:${week}:${day.id}`,
      activityType: "strength_training",
      summary: title.slice(0, 120),
      description: details.length ? details.map((d) => `${d.exercise} ${d.notes}`).join("; ") : `${title}, no sets logged`,
      startedAt: new Date(),
      details: details.length ? JSON.stringify(details) : null,
    })
    .onConflictDoNothing();
  await db(c).insert(schema.mesoSessions).values({ mesoId, dayId: day.id, week, userEmail: email, workoutId });
  L.sessions.push({ mesoId, dayId: day.id, week, userEmail: email, completedAt: new Date(), workoutId });

  if (week < L.meso.weeks) await ensureWeek(c, L, week + 1, day);
  let mesoCompleted = false;
  if (!nextSession(L)) {
    await db(c).update(schema.mesocycles).set({ status: "completed", endedDate: new Date().toISOString().slice(0, 10) }).where(eq(schema.mesocycles.id, mesoId));
    mesoCompleted = true;
  }
  const next = nextSession(L);
  return {
    ok: true as const,
    completed: { week, day: dayPos, setsLogged: doneSets.length, workoutId },
    next: next ? { week: next.week, day: next.day.position, label: next.day.label } : null,
    mesoCompleted,
  };
}

/** Swap a slot's exercise for this and later weeks (logged sets keep theirs). */
export async function swapExerciseForUser(c: Env, email: string, slotId: string, ref: { exerciseId?: unknown; exerciseName?: unknown }, fromWeek = 1) {
  const slot = (await db(c).select().from(schema.mesoSlots).where(and(eq(schema.mesoSlots.id, slotId), eq(schema.mesoSlots.userEmail, email))).limit(1))[0];
  if (!slot) return { error: "no slot with that id" };
  const ex = await resolveExercise(c, email, { id: ref.exerciseId, name: ref.exerciseName, muscle: slot.muscle });
  if (!ex) return { error: "no matching exercise in the library" };
  await db(c).update(schema.mesoSlots).set({ exerciseId: ex.id, exerciseName: ex.name, equipment: ex.equipment, muscle: ex.muscle }).where(eq(schema.mesoSlots.id, slotId));
  const future = await db(c)
    .select({ id: schema.mesoSets.id, week: schema.mesoSets.week })
    .from(schema.mesoSets)
    .where(and(eq(schema.mesoSets.slotId, slotId), isNull(schema.mesoSets.loggedAt)));
  const ids = future.filter((s) => s.week >= fromWeek).map((s) => s.id);
  // A new movement starts fresh: drop the old movement's load targets.
  for (const part of chunk(ids, 90))
    await db(c).update(schema.mesoSets).set({ exerciseName: ex.name, muscle: ex.muscle, targetWeightLb: null }).where(inArray(schema.mesoSets.id, part));
  return { ok: true as const, slotId, exercise: ex };
}

export async function updateMesocycleForUser(c: Env, email: string, id: string, input: { name?: unknown; notes?: unknown; status?: unknown }) {
  const meso = (await db(c).select().from(schema.mesocycles).where(and(eq(schema.mesocycles.id, id), eq(schema.mesocycles.userEmail, email))).limit(1))[0];
  if (!meso) return { error: "no mesocycle with that id" };
  const set: Partial<Meso> = {};
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) return { error: "name cannot be empty" };
    set.name = name;
  }
  if (input.notes !== undefined) set.notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) || null : null;
  if (input.status !== undefined) {
    if (input.status !== "completed" && input.status !== "abandoned") return { error: "status can only be set to completed or abandoned" };
    if (meso.status !== "active") return { error: "only an active mesocycle can be ended" };
    set.status = input.status;
    set.endedDate = new Date().toISOString().slice(0, 10);
  }
  if (!Object.keys(set).length) return { error: "nothing to change" };
  await db(c).update(schema.mesocycles).set(set).where(eq(schema.mesocycles.id, id));
  return { ok: true as const, mesocycle: await getMesocycleForUser(c, email, id) };
}

export async function deleteMesocycleForUser(c: Env, email: string, id: string): Promise<boolean> {
  const meso = (await db(c).select({ id: schema.mesocycles.id }).from(schema.mesocycles).where(and(eq(schema.mesocycles.id, id), eq(schema.mesocycles.userEmail, email))).limit(1))[0];
  if (!meso) return false;
  // The workouts its sessions logged stay: they're real training history.
  const d = db(c);
  await d.batch([
    d.delete(schema.mesoSets).where(eq(schema.mesoSets.mesoId, id)),
    d.delete(schema.mesoFeedback).where(eq(schema.mesoFeedback.mesoId, id)),
    d.delete(schema.mesoSessions).where(eq(schema.mesoSessions.mesoId, id)),
    d.delete(schema.mesoSlots).where(eq(schema.mesoSlots.mesoId, id)),
    d.delete(schema.mesoDays).where(eq(schema.mesoDays.mesoId, id)),
    d.delete(schema.mesocycles).where(eq(schema.mesocycles.id, id)),
  ]);
  return true;
}

/** Grounding lines for the agent prompts. */
export async function trainingLines(c: Env, email: string): Promise<string[]> {
  const id = await activeMesoId(c, email);
  if (!id) return ["- no active mesocycle"];
  const L = await loadMeso(c, email, id);
  if (!L) return ["- no active mesocycle"];
  const s = mesoSummary(L);
  const lines = [`- Active mesocycle "${s.name}" [id ${s.id}], ${s.weeks} weeks (last is deload) x ${s.daysPerWeek} days, ${s.sessionsDone}/${s.sessionsTotal} sessions done, started ${s.startDate}`];
  const next = nextSession(L);
  if (next) {
    await ensureWeek(c, L, next.week, next.day);
    const sess = sessionOut(L, next.week, next.day);
    lines.push(
      `- Next session: week ${sess.week} day ${sess.day}${sess.label ? ` (${sess.label})` : ""}, ${sess.deload ? "DELOAD week" : `target ${sess.targetRir} RIR`}: ` +
        sess.exercises
          .map((e) => {
            const logged = e.sets.filter((x) => x.done).length;
            const t = e.sets[0];
            const tgt = t ? `${t.targetWeightLb != null ? `${t.targetWeightLb} lb x ` : ""}${t.targetReps ?? "?"}` : "";
            return `${e.exerciseName} [${e.muscle}] ${e.sets.length} sets${tgt ? ` @ ${tgt}` : ""}${logged ? ` (${logged} logged)` : ""}`;
          })
          .join("; "),
    );
  }
  return lines;
}
