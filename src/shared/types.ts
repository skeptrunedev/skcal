// Shared between client and worker.

// Canonical storage is metric (kg, cm); the UI is imperial (lb, in).
export const LB_PER_KG = 2.2046226218;
export const CM_PER_IN = 2.54;
export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inch: number) => inch * CM_PER_IN;

export const MEASUREMENT_SITES = [
  "shoulders",
  "chest",
  "arm_l",
  "arm_r",
  "waist",
  "neck",
  "thigh",
  "glutes",
  "forearm_l",
  "forearm_r",
  "calf_l",
  "calf_r",
] as const;
export type MeasurementSite = (typeof MEASUREMENT_SITES)[number];

export const SITE_LABELS: Record<string, string> = {
  shoulders: "Shoulders",
  chest: "Chest",
  arm_l: "Arm (L)",
  arm_r: "Arm (R)",
  waist: "Waist",
  neck: "Neck",
  thigh: "Thigh",
  glutes: "Glutes",
  forearm_l: "Forearm (L)",
  forearm_r: "Forearm (R)",
  calf_l: "Calf (L)",
  calf_r: "Calf (R)",
};

export type Adherence = "under" | "on" | "over";

export type NutritionDay = {
  date: string; // YYYY-MM-DD
  kcal: number | null;
  proteinG: number | null;
  hitProtein: boolean | null;
  adherence: Adherence | null;
};

export type Targets = {
  goalWeightKg: number | null;
  startWeightKg: number | null;
  targetDate: number | null;
  startDate: number | null;
  dailyKcalTarget: number | null;
  proteinTargetG: number | null;
  heightCm: number | null;
  sex: "male" | "female" | "other" | null;
};

// A goal phase (bulk / cut / maintain) with planned vs actual weekly rate.
export type Phase = {
  id: string;
  kind: "bulk" | "cut" | "maintain";
  startDate: string;
  plannedEndDate: string | null;
  endedDate: string | null;
  active: boolean;
  startWeightLb: number | null;
  goalWeightLb: number | null;
  ratePctPerWeek: number | null;
  dailyKcalTarget: number | null;
  proteinTargetG: number | null;
  note: string | null;
  progress: {
    weeksElapsed: number;
    weeksPlanned: number | null;
    latestWeightLb: number | null;
    changeLb: number | null;
    plannedLbPerWeek: number | null;
    actualLbPerWeek: number | null;
    actualPctPerWeek: number | null;
    status: "on_track" | "too_fast" | "too_slow" | "not_enough_data";
  };
};

export type DashboardData = {
  weight: {
    latestKg: number | null;
    weeklyAvgKg: number | null;
    bodyFatPct: number | null;
    note: string | null;
    trend: { ts: number; kg: number }[];
  };
  targets: Targets;
  measurementsLatest: { site: string; valueCm: number; ts: number }[];
  shoulderToWaist: number | null;
  nutritionToday: NutritionDay | null;
  phase: Phase | null;
};

// Fine-grained API-key scopes (resource:action). An API key holding the special
// "*" scope has full access; the UI defaults new keys to "*".
export const API_SCOPES = [
  "weight:read",
  "weight:write",
  "measurements:read",
  "measurements:write",
  "nutrition:read",
  "nutrition:write",
  "targets:read",
  "targets:write",
  "training:read",
  "training:write",
  "dashboard:read",
  "agent:read",
  "agent:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

// ---- training (RP-style mesocycles), as /api/training returns them ----------
export type MuscleInfo = {
  key: string;
  label: string;
  mv: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  freqLow: number;
  freqHigh: number;
  defaultReps: number;
};
export type TrainingTemplate = { key: string; name: string; description: string; days: { label: string; muscles: string[] }[] };
export type Exercise = { id: string; name: string; muscle: string; equipment: string; videoUrl: string | null; custom: boolean };
export type FeedbackScales = { soreness: string[]; pump: string[]; jointPain: string[]; workload: string[] };
export type TrainingLibrary = {
  muscles: MuscleInfo[];
  equipment: string[];
  templates: TrainingTemplate[];
  feedbackScales: FeedbackScales;
  exercises: Exercise[];
};
export type MesoCalendarWeek = { week: number; rir: number | null; deload: boolean; days: { day: number; label: string | null; done: boolean }[] };
export type MesoSummary = {
  id: string;
  name: string;
  weeks: number;
  daysPerWeek: number;
  startDate: string;
  status: "active" | "completed" | "abandoned";
  endedDate: string | null;
  notes: string | null;
  sessionsDone: number;
  sessionsTotal: number;
  next: { week: number; day: number; label: string | null } | null;
  muscles: string[];
  calendar: MesoCalendarWeek[];
};
export type MesoDetail = MesoSummary & {
  days: { id: string; day: number; label: string | null; slots: { id: string; muscle: string; exerciseId: string; exerciseName: string; equipment: string }[] }[];
  volume: { muscle: string; label: string; mev: number | null; mav: [number, number] | null; mrv: number | null; setsByWeek: number[] }[];
};
export type TrainingSet = {
  id: string;
  position: number;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetRir: number | null;
  weightLb: number | null;
  reps: number | null;
  done: boolean;
  loggedAt: number | null;
};
export type MuscleFeedback = { muscle: string; soreness: number | null; pump: number | null; jointPain: number | null; workload: number | null };
export type TrainingSession = {
  meso: { id: string; name: string; weeks: number; daysPerWeek: number; status: string };
  week: number;
  day: number;
  dayId: string;
  label: string | null;
  targetRir: number | null;
  deload: boolean;
  completed: boolean;
  completedAt: number | null;
  exercises: {
    slotId: string;
    muscle: string;
    exerciseId: string;
    exerciseName: string;
    equipment: string;
    sets: TrainingSet[];
    lastWeek: { weightLb: number | null; reps: number | null }[];
  }[];
  feedback: MuscleFeedback[];
  feedbackScales: FeedbackScales;
};
