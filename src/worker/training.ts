// Mesocycle programming math, modeled on RP Hypertrophy: per-week RIR
// targets, starting volume from each muscle's MEV, week-to-week set
// progression from the user's soreness / pump / joint-pain / workload
// feedback, rep-and-load progression from what they actually lifted, and the
// final deload week. Pure (no Worker or DB imports) so it's unit-tested
// directly; src/worker/training-store applies it to rows.
import { MUSCLES, type Muscle } from "./training-data";

export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "smith", "bodyweight", "band", "other"] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MIN_WEEKS = 3; // 2 accumulation + deload
export const MAX_WEEKS = 8;
export const MIN_DAYS = 1;
export const MAX_DAYS = 7;
const MAX_SETS_PER_SLOT = 8;

// RP's feedback questions with their answers (0 = first option).
export const FEEDBACK_SCALES = {
  soreness: ["Never got sore", "Healed a while ago", "Healed just on time", "I'm still sore"],
  pump: ["Low pump", "Moderate pump", "Amazing pump"],
  jointPain: ["No pain", "Low pain", "Moderate pain", "A lot of pain"],
  workload: ["Easy", "Pretty good", "Pushed my limits", "Too much"],
} as const;
export type FeedbackKey = keyof typeof FEEDBACK_SCALES;
export type Feedback = { soreness: number | null; pump: number | null; jointPain: number | null; workload: number | null };

export const muscleInfo = (m: string) => MUSCLES.find((x) => x.key === m) ?? null;
export const isMuscle = (m: unknown): m is Muscle => typeof m === "string" && MUSCLES.some((x) => x.key === m);

/** True for the mesocycle's final (deload) week. */
export const isDeload = (week: number, weeks: number) => week === weeks;

/**
 * Target reps-in-reserve for a week: 3 in week 1 falling evenly to 0 in the
 * last accumulation week (4 accumulation weeks = 3, 2, 1, 0). The deload week
 * has no RIR target (null): it's light by design.
 */
export function rirForWeek(week: number, weeks: number): number | null {
  if (isDeload(week, weeks)) return null;
  const acc = weeks - 1;
  if (acc <= 1) return 3;
  return Math.round(3 - (3 * (week - 1)) / (acc - 1));
}

/**
 * Week-1 sets for each slot: the muscle's MEV for the week, split across every
 * slot that trains it (all days), at least 2 sets per slot.
 */
export function initialSetCounts(slots: { id: string; muscle: string }[]): Map<string, number> {
  const perMuscle = new Map<string, number>();
  for (const s of slots) perMuscle.set(s.muscle, (perMuscle.get(s.muscle) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const s of slots) {
    const mev = muscleInfo(s.muscle)?.mev ?? 6;
    out.set(s.id, Math.min(MAX_SETS_PER_SLOT, Math.max(2, Math.round(mev / (perMuscle.get(s.muscle) ?? 1)))));
  }
  return out;
}

/**
 * Sets to add (or drop) for a muscle on a given day next week, from this
 * week's feedback for it. Mirrors RP's logic: room to recover (never sore /
 * healed early) plus a weak stimulus (low pump or easy workload) earns the
 * most volume; still being sore, "too much", or real joint pain holds or cuts.
 * No feedback = +1, the default weekly ramp. The caller caps at MRV.
 */
export function setDelta(fb: Feedback | null): number {
  if (!fb || (fb.soreness == null && fb.pump == null && fb.workload == null && fb.jointPain == null)) return 1;
  const { soreness, pump, jointPain, workload } = fb;
  if ((jointPain ?? 0) >= 3) return -1;
  if (soreness === 3 && workload === 3) return -1;
  if (soreness === 3 || workload === 3 || (jointPain ?? 0) >= 2) return 0;
  const recovered = soreness == null || soreness <= 1;
  const weakStimulus = pump === 0 || workload === 0;
  if (recovered && weakStimulus) return 2;
  if (recovered || (soreness === 2 && (workload ?? 1) <= 1)) return 1;
  return 0;
}

/** Load increment in pounds for a piece of equipment (0 = progress by reps). */
export function loadStep(equipment: string): number {
  if (equipment === "bodyweight" || equipment === "band") return 0;
  return 5;
}

const roundTo = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n);

export type SetResult = { targetReps: number | null; targetWeightLb: number | null; weightLb: number | null; reps: number | null };
export type SetTarget = { targetReps: number | null; targetWeightLb: number | null };

/**
 * Next week's target for one set from this week's same set. Hit the rep
 * target (or beat last week's reps with no target) at that weight → add the
 * equipment's load step (~2-5%) and keep the reps; bodyweight moves add a rep.
 * Missed by 1-2 → same load, aim one rep past what was done. Missed by 3+ →
 * same load, match what was done. Not logged → carry the targets forward.
 */
export function nextSetTarget(prev: SetResult, equipment: string): SetTarget {
  if (prev.reps == null || prev.weightLb == null) return { targetReps: prev.targetReps, targetWeightLb: prev.targetWeightLb };
  const goal = prev.targetReps ?? prev.reps;
  const step = loadStep(equipment);
  if (prev.reps >= goal) {
    if (step === 0) return { targetReps: prev.reps + 1, targetWeightLb: prev.weightLb };
    // ~2.5% heavier, but always at least one step.
    const up = Math.max(prev.weightLb + step, roundTo(prev.weightLb * 1.025, step));
    return { targetReps: goal, targetWeightLb: up };
  }
  const short = goal - prev.reps;
  return { targetReps: short <= 2 ? prev.reps + 1 : prev.reps, targetWeightLb: prev.weightLb };
}

/**
 * Deload targets from the last accumulation week's set: half the sets (the
 * caller keeps the first ceil(n/2)), the same load for half the reps.
 */
export function deloadSetTarget(prev: SetResult): SetTarget {
  const reps = prev.reps ?? prev.targetReps;
  return { targetReps: reps != null ? Math.max(1, Math.round(reps / 2)) : null, targetWeightLb: prev.weightLb ?? prev.targetWeightLb };
}

export type PlanSlot = { slotId: string; muscle: string; equipment: string; sets: SetResult[] };

/**
 * Plan next week's sets for one training day. `weekVolume` is the muscle's
 * total sets across the whole current week (all days), so the added sets stop
 * at MRV. Extra sets for a muscle go on its first slot of the day; cuts come
 * off its last slot (never below 1 set). A muscle with nothing logged this
 * week holds its set count. Returns targets per slot.
 */
export function planNextWeek(
  daySlots: PlanSlot[],
  feedbackByMuscle: Map<string, Feedback>,
  weekVolume: Map<string, number>,
  nextWeek: number,
  weeks: number,
): Map<string, SetTarget[]> {
  const out = new Map<string, SetTarget[]>();
  if (isDeload(nextWeek, weeks)) {
    for (const s of daySlots) {
      const keep = Math.max(1, Math.ceil(s.sets.length / 2));
      out.set(s.slotId, s.sets.slice(0, keep).map(deloadSetTarget));
    }
    return out;
  }
  for (const s of daySlots) out.set(s.slotId, s.sets.map((set) => nextSetTarget(set, s.equipment)));

  const muscles = [...new Set(daySlots.map((s) => s.muscle))];
  for (const m of muscles) {
    const slots = daySlots.filter((s) => s.muscle === m);
    const mrv = muscleInfo(m)?.mrv ?? 20;
    // A muscle skipped this week (nothing logged) holds its volume.
    const trained = slots.some((s) => s.sets.some((x) => x.reps != null));
    let delta = trained ? setDelta(feedbackByMuscle.get(m) ?? null) : 0;
    const vol = weekVolume.get(m) ?? 0;
    if (delta > 0) delta = Math.max(0, Math.min(delta, mrv - vol));
    if (delta > 0) {
      const first = out.get(slots[0].slotId)!;
      const room = MAX_SETS_PER_SLOT - first.length;
      const template = first.at(-1) ?? { targetReps: null, targetWeightLb: null };
      for (let i = 0; i < Math.min(delta, room); i++) first.push({ ...template });
    } else if (delta < 0) {
      const last = out.get(slots[slots.length - 1].slotId)!;
      if (last.length > 1) last.pop();
    }
  }
  return out;
}
