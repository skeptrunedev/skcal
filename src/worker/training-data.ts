// Built-in training data: muscle groups with Renaissance Periodization's
// weekly volume landmarks (hard sets per week), split templates, and the
// exercise library. Landmark values follow RP's per-muscle "Hypertrophy
// Training Tips" guides as rewritten in Dec 2023 (rpstrength.com, Dr. Mike
// Israetel), taking the top of each published range:
//   MV  maintenance volume       MEV minimum effective volume
//   MAV maximum adaptive volume (a range)   MRV maximum recoverable volume
// Users can add their own exercises (the `exercises` table); landmarks and
// templates are code so every surface reads one copy.

export type Muscle =
  | "chest"
  | "back"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "biceps"
  | "triceps"
  | "calves"
  | "abs"
  | "traps"
  | "forearms";

export type MuscleInfo = {
  key: Muscle;
  label: string;
  mv: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  freqLow: number; // sessions per week
  freqHigh: number;
  defaultReps: number; // week-1 rep target
};

export const MUSCLES: MuscleInfo[] = [
  { key: "chest", label: "Chest", mv: 4, mev: 6, mavLow: 6, mavHigh: 16, mrv: 24, freqLow: 2, freqHigh: 4, defaultReps: 10 },
  { key: "back", label: "Back", mv: 6, mev: 8, mavLow: 8, mavHigh: 20, mrv: 26, freqLow: 2, freqHigh: 4, defaultReps: 10 },
  { key: "quads", label: "Quads", mv: 4, mev: 6, mavLow: 6, mavHigh: 14, mrv: 18, freqLow: 2, freqHigh: 5, defaultReps: 10 },
  { key: "hamstrings", label: "Hamstrings", mv: 2, mev: 4, mavLow: 4, mavHigh: 8, mrv: 14, freqLow: 2, freqHigh: 3, defaultReps: 10 },
  { key: "glutes", label: "Glutes", mv: 6, mev: 8, mavLow: 8, mavHigh: 24, mrv: 30, freqLow: 2, freqHigh: 5, defaultReps: 12 },
  { key: "front_delts", label: "Front Delts", mv: 2, mev: 2, mavLow: 4, mavHigh: 8, mrv: 12, freqLow: 2, freqHigh: 3, defaultReps: 10 },
  { key: "side_delts", label: "Side Delts", mv: 6, mev: 8, mavLow: 8, mavHigh: 24, mrv: 30, freqLow: 3, freqHigh: 6, defaultReps: 15 },
  { key: "rear_delts", label: "Rear Delts", mv: 4, mev: 4, mavLow: 4, mavHigh: 12, mrv: 20, freqLow: 3, freqHigh: 6, defaultReps: 15 },
  { key: "biceps", label: "Biceps", mv: 4, mev: 8, mavLow: 8, mavHigh: 20, mrv: 26, freqLow: 3, freqHigh: 6, defaultReps: 12 },
  { key: "triceps", label: "Triceps", mv: 4, mev: 6, mavLow: 6, mavHigh: 16, mrv: 20, freqLow: 2, freqHigh: 4, defaultReps: 12 },
  { key: "calves", label: "Calves", mv: 4, mev: 6, mavLow: 6, mavHigh: 16, mrv: 24, freqLow: 3, freqHigh: 6, defaultReps: 12 },
  { key: "abs", label: "Abs", mv: 4, mev: 4, mavLow: 4, mavHigh: 12, mrv: 20, freqLow: 3, freqHigh: 6, defaultReps: 15 },
  { key: "traps", label: "Traps", mv: 4, mev: 4, mavLow: 4, mavHigh: 12, mrv: 20, freqLow: 2, freqHigh: 4, defaultReps: 15 },
  { key: "forearms", label: "Forearms", mv: 4, mev: 8, mavLow: 8, mavHigh: 24, mrv: 30, freqLow: 3, freqHigh: 6, defaultReps: 15 },
];

export type Template = { key: string; name: string; description: string; days: { label: string; muscles: Muscle[] }[] };

// Splits in the style of RP's starter templates. Each muscle slot gets the
// library's first exercise for it unless the caller picks one.
export const TEMPLATES: Template[] = [
  {
    key: "full_body_3",
    name: "Full Body 3x",
    description: "Three full-body days; every major muscle twice or three times a week.",
    days: [
      { label: "Full Body A", muscles: ["quads", "chest", "back", "side_delts", "biceps", "calves"] },
      { label: "Full Body B", muscles: ["hamstrings", "back", "chest", "rear_delts", "triceps", "abs"] },
      { label: "Full Body C", muscles: ["quads", "chest", "back", "side_delts", "biceps", "triceps"] },
    ],
  },
  {
    key: "upper_lower_4",
    name: "Upper / Lower 4x",
    description: "Two upper and two lower days a week.",
    days: [
      { label: "Upper A", muscles: ["chest", "back", "side_delts", "triceps", "biceps"] },
      { label: "Lower A", muscles: ["quads", "hamstrings", "glutes", "calves", "abs"] },
      { label: "Upper B", muscles: ["back", "chest", "rear_delts", "biceps", "triceps"] },
      { label: "Lower B", muscles: ["hamstrings", "quads", "glutes", "calves"] },
    ],
  },
  {
    key: "upper_focus_4",
    name: "Upper Body 4x",
    description: "Four upper-body days for a physique focus on chest, back, delts, and arms (legs on maintenance).",
    days: [
      { label: "Upper A", muscles: ["chest", "back", "side_delts", "triceps", "biceps"] },
      { label: "Upper B", muscles: ["back", "chest", "rear_delts", "biceps", "triceps"] },
      { label: "Upper C", muscles: ["chest", "side_delts", "back", "triceps", "biceps"] },
      { label: "Upper D", muscles: ["back", "side_delts", "chest", "rear_delts", "biceps", "triceps"] },
    ],
  },
  {
    key: "ppl_3",
    name: "Push / Pull / Legs 3x",
    description: "One push, one pull, and one leg day a week.",
    days: [
      { label: "Push", muscles: ["chest", "chest", "side_delts", "triceps"] },
      { label: "Pull", muscles: ["back", "back", "rear_delts", "biceps"] },
      { label: "Legs", muscles: ["quads", "hamstrings", "glutes", "calves"] },
    ],
  },
  {
    key: "ppl_6",
    name: "Push / Pull / Legs 6x",
    description: "Push, pull, and legs twice a week.",
    days: [
      { label: "Push A", muscles: ["chest", "side_delts", "triceps", "chest"] },
      { label: "Pull A", muscles: ["back", "rear_delts", "biceps", "back"] },
      { label: "Legs A", muscles: ["quads", "hamstrings", "calves", "abs"] },
      { label: "Push B", muscles: ["chest", "chest", "side_delts", "triceps"] },
      { label: "Pull B", muscles: ["back", "back", "biceps", "traps"] },
      { label: "Legs B", muscles: ["hamstrings", "quads", "glutes", "calves"] },
    ],
  },
];

export type BuiltinExercise = { id: string; name: string; muscle: Muscle; equipment: string; videoUrl?: string };

const ex = (muscle: Muscle, equipment: string, name: string): BuiltinExercise => ({
  id: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, ""),
  name,
  muscle,
  equipment,
});

// Order matters: the first exercise per muscle is the default for a slot.
export const BUILTIN_EXERCISES: BuiltinExercise[] = [
  // chest
  ex("chest", "barbell", "Barbell Bench Press"),
  ex("chest", "dumbbell", "Incline Dumbbell Press"),
  ex("chest", "barbell", "Incline Barbell Press"),
  ex("chest", "dumbbell", "Dumbbell Bench Press"),
  ex("chest", "machine", "Machine Chest Press"),
  ex("chest", "smith", "Smith Machine Incline Press"),
  ex("chest", "cable", "Cable Flye"),
  ex("chest", "dumbbell", "Dumbbell Flye"),
  ex("chest", "machine", "Pec Deck"),
  ex("chest", "bodyweight", "Deficit Push-Up"),
  ex("chest", "bodyweight", "Dip"),
  // back
  ex("back", "cable", "Lat Pulldown"),
  ex("back", "barbell", "Barbell Row"),
  ex("back", "bodyweight", "Pull-Up"),
  ex("back", "bodyweight", "Chin-Up"),
  ex("back", "cable", "Seated Cable Row"),
  ex("back", "dumbbell", "One-Arm Dumbbell Row"),
  ex("back", "machine", "Chest-Supported Row"),
  ex("back", "barbell", "Pendlay Row"),
  ex("back", "machine", "Machine Pulldown"),
  ex("back", "cable", "Cable Pullover"),
  ex("back", "barbell", "T-Bar Row"),
  // quads
  ex("quads", "barbell", "High-Bar Back Squat"),
  ex("quads", "machine", "Hack Squat"),
  ex("quads", "machine", "Leg Press"),
  ex("quads", "machine", "Leg Extension"),
  ex("quads", "barbell", "Front Squat"),
  ex("quads", "smith", "Smith Machine Squat"),
  ex("quads", "machine", "Pendulum Squat"),
  ex("quads", "dumbbell", "Bulgarian Split Squat"),
  ex("quads", "dumbbell", "Walking Lunge"),
  // hamstrings
  ex("hamstrings", "barbell", "Romanian Deadlift"),
  ex("hamstrings", "machine", "Seated Leg Curl"),
  ex("hamstrings", "machine", "Lying Leg Curl"),
  ex("hamstrings", "barbell", "Stiff-Legged Deadlift"),
  ex("hamstrings", "dumbbell", "Dumbbell Romanian Deadlift"),
  ex("hamstrings", "barbell", "Good Morning"),
  ex("hamstrings", "bodyweight", "Glute-Ham Raise"),
  ex("hamstrings", "bodyweight", "Nordic Curl"),
  // glutes
  ex("glutes", "barbell", "Barbell Hip Thrust"),
  ex("glutes", "machine", "Machine Hip Thrust"),
  ex("glutes", "dumbbell", "Dumbbell Step-Up"),
  ex("glutes", "barbell", "Deadlift"),
  ex("glutes", "cable", "Cable Pull-Through"),
  ex("glutes", "machine", "Hip Abduction Machine"),
  ex("glutes", "bodyweight", "Glute Bridge"),
  ex("glutes", "machine", "45-Degree Back Extension"),
  // front delts
  ex("front_delts", "barbell", "Overhead Press"),
  ex("front_delts", "dumbbell", "Seated Dumbbell Shoulder Press"),
  ex("front_delts", "machine", "Machine Shoulder Press"),
  ex("front_delts", "smith", "Smith Machine Overhead Press"),
  ex("front_delts", "dumbbell", "Dumbbell Front Raise"),
  ex("front_delts", "cable", "Cable Front Raise"),
  // side delts
  ex("side_delts", "dumbbell", "Dumbbell Lateral Raise"),
  ex("side_delts", "cable", "Cable Lateral Raise"),
  ex("side_delts", "machine", "Machine Lateral Raise"),
  ex("side_delts", "barbell", "Barbell Upright Row"),
  ex("side_delts", "cable", "Cable Upright Row"),
  ex("side_delts", "dumbbell", "Lean-Away Dumbbell Lateral Raise"),
  // rear delts
  ex("rear_delts", "machine", "Reverse Pec Deck"),
  ex("rear_delts", "dumbbell", "Bent-Over Dumbbell Reverse Flye"),
  ex("rear_delts", "cable", "Cable Reverse Flye"),
  ex("rear_delts", "cable", "Face Pull"),
  ex("rear_delts", "dumbbell", "Incline Dumbbell Rear Delt Row"),
  // biceps
  ex("biceps", "barbell", "Barbell Curl"),
  ex("biceps", "dumbbell", "Incline Dumbbell Curl"),
  ex("biceps", "barbell", "EZ-Bar Curl"),
  ex("biceps", "dumbbell", "Dumbbell Curl"),
  ex("biceps", "dumbbell", "Hammer Curl"),
  ex("biceps", "cable", "Cable Curl"),
  ex("biceps", "machine", "Preacher Curl Machine"),
  ex("biceps", "barbell", "EZ-Bar Preacher Curl"),
  ex("biceps", "cable", "Bayesian Cable Curl"),
  // triceps
  ex("triceps", "cable", "Cable Triceps Pushdown"),
  ex("triceps", "barbell", "EZ-Bar Skull Crusher"),
  ex("triceps", "cable", "Overhead Cable Triceps Extension"),
  ex("triceps", "barbell", "Close-Grip Bench Press"),
  ex("triceps", "dumbbell", "Dumbbell Overhead Triceps Extension"),
  ex("triceps", "machine", "Machine Triceps Extension"),
  ex("triceps", "bodyweight", "Bench Dip"),
  ex("triceps", "smith", "Smith Machine JM Press"),
  // calves
  ex("calves", "machine", "Standing Calf Raise"),
  ex("calves", "machine", "Seated Calf Raise"),
  ex("calves", "machine", "Leg Press Calf Raise"),
  ex("calves", "smith", "Smith Machine Calf Raise"),
  ex("calves", "dumbbell", "Single-Leg Dumbbell Calf Raise"),
  // abs
  ex("abs", "cable", "Cable Crunch"),
  ex("abs", "bodyweight", "Hanging Leg Raise"),
  ex("abs", "bodyweight", "Ab Wheel Rollout"),
  ex("abs", "machine", "Machine Crunch"),
  ex("abs", "bodyweight", "Slant Board Sit-Up"),
  ex("abs", "bodyweight", "Modified Candlestick"),
  // traps
  ex("traps", "barbell", "Barbell Shrug"),
  ex("traps", "dumbbell", "Dumbbell Shrug"),
  ex("traps", "cable", "Cable Shrug"),
  ex("traps", "machine", "Machine Shrug"),
  ex("traps", "barbell", "Rack Pull"),
  // forearms
  ex("forearms", "barbell", "Barbell Wrist Curl"),
  ex("forearms", "dumbbell", "Dumbbell Wrist Curl"),
  ex("forearms", "barbell", "Reverse Barbell Curl"),
  ex("forearms", "dumbbell", "Farmer's Walk"),
  ex("forearms", "cable", "Cable Wrist Curl"),
];
