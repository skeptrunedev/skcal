// HTTP routes for goal phases (bulk / cut / maintain) and mesocycle training.
// Thin wrappers over ./phases and ./training-store, which the coach and MCP
// tools call too. Registered on the main app after the /api auth middleware,
// so every handler runs scoped to c.get("email").
import { Hono, type Context } from "hono";
import { deletePhaseForUser, endPhaseForUser, listPhasesForUser, startPhaseForUser, updatePhaseForUser, type PhaseInput } from "./phases";
import {
  addSetForUser,
  completeSessionForUser,
  createExerciseForUser,
  createMesocycleForUser,
  currentSessionForUser,
  deleteExerciseForUser,
  deleteMesocycleForUser,
  deleteSetForUser,
  getMesocycleForUser,
  getSessionForUser,
  listExercisesForUser,
  listMesocyclesForUser,
  logSetsForUser,
  setFeedbackForUser,
  swapExerciseForUser,
  updateMesocycleForUser,
  updateSetForUser,
} from "./training-store";
import { EQUIPMENT, FEEDBACK_SCALES } from "./training";
import { MUSCLES, TEMPLATES } from "./training-data";

/**
 * @openapi
 * components:
 *   parameters:
 *     Today:
 *       name: date
 *       in: query
 *       required: false
 *       description: The caller's local calendar day (YYYY-MM-DD), the default start or end day. Defaults to the server's UTC date.
 *       schema:
 *         type: string
 *         format: date
 *         example: "2026-10-24"
 *     PhaseId:
 *       name: id
 *       in: path
 *       required: true
 *       description: Phase identifier (UUID).
 *       schema:
 *         type: string
 *         format: uuid
 *         example: 3f2c1a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f
 *     TrainingId:
 *       name: id
 *       in: path
 *       required: true
 *       description: Identifier of the mesocycle, set, slot, or custom exercise the path names.
 *       schema:
 *         type: string
 *         example: 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d
 *     Week:
 *       name: week
 *       in: path
 *       required: true
 *       description: Week number within the mesocycle, starting at 1 (the last week is the deload).
 *       schema:
 *         type: integer
 *         minimum: 1
 *         example: 2
 *     Day:
 *       name: day
 *       in: path
 *       required: true
 *       description: Training day number within the week, starting at 1.
 *       schema:
 *         type: integer
 *         minimum: 1
 *         example: 3
 *   schemas:
 *     PhaseInput:
 *       type: object
 *       description: A goal phase's fields. Every field is optional when editing.
 *       additionalProperties: false
 *       properties:
 *         kind:
 *           type: string
 *           enum: [bulk, cut, maintain]
 *           description: Phase type; required to start a phase.
 *           example: bulk
 *         startDate:
 *           type: string
 *           format: date
 *           description: First day of the phase (default today).
 *           example: "2026-10-24"
 *         plannedEndDate:
 *           type: [string, "null"]
 *           format: date
 *           description: Planned last day (YYYY-MM-DD); empty or null clears it.
 *           example: "2027-01-16"
 *         goalWeightLb:
 *           type: [number, "null"]
 *           description: Goal body weight in pounds (default the start weight projected over the planned length).
 *           example: 180
 *         ratePctPerWeek:
 *           type: [number, "null"]
 *           description: Planned weekly change as a percent of bodyweight; positive gains, negative loses.
 *           example: 0.25
 *         dailyKcal:
 *           type: [integer, "null"]
 *           description: Daily calorie target (default maintenance from logged data plus the rate's surplus or deficit).
 *           example: 2900
 *         proteinG:
 *           type: [integer, "null"]
 *           description: Daily protein target in grams to set with the phase.
 *           example: 180
 *         note:
 *           type: [string, "null"]
 *           description: Free-text note, e.g. the reason for the phase.
 *           example: lean bulk for the winter
 *     Phase:
 *       type: object
 *       description: A goal phase with its progress.
 *       additionalProperties: false
 *       required: [id, kind, startDate, plannedEndDate, endedDate, active, startWeightLb, goalWeightLb, ratePctPerWeek, dailyKcalTarget, proteinTargetG, note, progress]
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Phase identifier.
 *           example: 3f2c1a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f
 *         kind:
 *           type: string
 *           enum: [bulk, cut, maintain]
 *           description: Phase type.
 *           example: bulk
 *         startDate:
 *           type: string
 *           format: date
 *           description: First day.
 *           example: "2026-10-24"
 *         plannedEndDate:
 *           type: [string, "null"]
 *           format: date
 *           description: Planned last day.
 *           example: "2027-01-16"
 *         endedDate:
 *           type: [string, "null"]
 *           format: date
 *           description: Day it ended; null while it's the open phase.
 *           example: null
 *         active:
 *           type: boolean
 *           description: True for the open phase.
 *           example: true
 *         startWeightLb:
 *           type: [number, "null"]
 *           description: Bodyweight at the start, in pounds.
 *           example: 165.2
 *         goalWeightLb:
 *           type: [number, "null"]
 *           description: Goal bodyweight in pounds.
 *           example: 170.2
 *         ratePctPerWeek:
 *           type: [number, "null"]
 *           description: Planned weekly change, percent of bodyweight.
 *           example: 0.25
 *         dailyKcalTarget:
 *           type: [integer, "null"]
 *           description: The phase's daily calorie target.
 *           example: 2900
 *         proteinTargetG:
 *           type: [integer, "null"]
 *           description: The phase's daily protein target in grams.
 *           example: 180
 *         note:
 *           type: [string, "null"]
 *           description: Free-text note.
 *           example: lean bulk for the winter
 *         progress:
 *           $ref: '#/components/schemas/PhaseProgress'
 *     PhaseProgress:
 *       type: object
 *       description: Planned vs actual rate of change, from a least-squares fit over the phase's weigh-ins.
 *       additionalProperties: false
 *       required: [weeksElapsed, weeksPlanned, latestWeightLb, changeLb, plannedLbPerWeek, actualLbPerWeek, actualPctPerWeek, status]
 *       properties:
 *         weeksElapsed:
 *           type: number
 *           description: Weeks since the start (to the end, for a closed phase).
 *           example: 3.4
 *         weeksPlanned:
 *           type: [number, "null"]
 *           description: Planned length in weeks.
 *           example: 12
 *         latestWeightLb:
 *           type: [number, "null"]
 *           description: Latest weigh-in within the phase, in pounds.
 *           example: 167.1
 *         changeLb:
 *           type: [number, "null"]
 *           description: Change since the start, in pounds.
 *           example: 1.9
 *         plannedLbPerWeek:
 *           type: [number, "null"]
 *           description: Planned weekly change in pounds.
 *           example: 0.41
 *         actualLbPerWeek:
 *           type: [number, "null"]
 *           description: Actual weekly change in pounds (null before a week of weigh-ins).
 *           example: 0.52
 *         actualPctPerWeek:
 *           type: [number, "null"]
 *           description: Actual weekly change as a percent of start weight.
 *           example: 0.31
 *         status:
 *           type: string
 *           enum: [on_track, too_fast, too_slow, not_enough_data]
 *           description: Whether the actual rate is within a third of the plan.
 *           example: on_track
 *     PhaseList:
 *       type: object
 *       description: Every goal phase plus the open one and a maintenance estimate.
 *       example: { active: null, phases: [], maintenance: { kcal: 2650, days: 24 } }
 *       additionalProperties: false
 *       required: [active, phases, maintenance]
 *       properties:
 *         active:
 *           description: The open phase, if any.
 *           example: null
 *           oneOf:
 *             - $ref: '#/components/schemas/Phase'
 *             - type: "null"
 *         phases:
 *           type: array
 *           description: Every phase, newest first.
 *           items:
 *             $ref: '#/components/schemas/Phase'
 *         maintenance:
 *           description: Maintenance calories estimated from the last 28 days of logged intake and weigh-ins.
 *           oneOf:
 *             - $ref: '#/components/schemas/MaintenanceEstimate'
 *             - type: "null"
 *     MaintenanceEstimate:
 *       type: object
 *       description: Data-driven maintenance calories.
 *       additionalProperties: false
 *       required: [kcal, days]
 *       properties:
 *         kcal:
 *           type: integer
 *           description: Estimated daily maintenance calories.
 *           example: 2650
 *         days:
 *           type: integer
 *           description: Logged days the estimate used.
 *           example: 24
 *     PhaseStarted:
 *       type: object
 *       description: Result of starting a phase.
 *       additionalProperties: false
 *       required: [ok, phase, closedPhaseId, kcalSource, maintenanceKcal]
 *       properties:
 *         ok:
 *           type: boolean
 *           const: true
 *           description: True once the phase is started.
 *           example: true
 *         phase:
 *           $ref: '#/components/schemas/Phase'
 *         closedPhaseId:
 *           type: [string, "null"]
 *           description: The phase this one closed, if one was open.
 *           example: null
 *         kcalSource:
 *           type: string
 *           enum: [given, estimated, unchanged]
 *           description: Where the calorie target came from; unchanged means there wasn't enough data to estimate maintenance.
 *           example: estimated
 *         maintenanceKcal:
 *           type: [integer, "null"]
 *           description: The maintenance estimate used, if any.
 *           example: 2650
 *     PhaseUpdated:
 *       type: object
 *       description: Result of editing a phase.
 *       additionalProperties: false
 *       required: [ok, phase]
 *       properties:
 *         ok:
 *           type: boolean
 *           const: true
 *           description: True once the edit is saved.
 *           example: true
 *         phase:
 *           $ref: '#/components/schemas/Phase'
 *     TrainingLibrary:
 *       type: object
 *       description: Muscles with volume landmarks, equipment, split templates, feedback scales, and exercises.
 *       additionalProperties: false
 *       required: [muscles, equipment, templates, feedbackScales, exercises]
 *       properties:
 *         muscles:
 *           type: array
 *           description: Muscle groups with weekly hard-set landmarks (MV, MEV, MAV range, MRV) and default reps.
 *           items:
 *             type: object
 *             description: One muscle group.
 *           example: [{ key: chest, label: Chest, mv: 4, mev: 6, mavLow: 12, mavHigh: 20, mrv: 22 }]
 *         equipment:
 *           type: array
 *           description: Equipment types.
 *           items:
 *             type: string
 *           example: [barbell, dumbbell, machine]
 *         templates:
 *           type: array
 *           description: Split templates usable as the template field when creating a mesocycle.
 *           items:
 *             type: object
 *             description: One split template.
 *           example: [{ key: upper_lower_4, name: Upper / Lower, days: [{ label: Upper A, muscles: [chest, back] }] }]
 *         feedbackScales:
 *           type: object
 *           description: Answers for each feedback question, by index.
 *           example: { pump: [Low pump, Moderate pump, Amazing pump] }
 *         exercises:
 *           type: array
 *           description: Built-in and custom exercises.
 *           items:
 *             type: object
 *             description: One exercise.
 *           example: [{ id: barbell_bench_press, name: Barbell Bench Press, muscle: chest, equipment: barbell, videoUrl: null, custom: false }]
 *     ExerciseInput:
 *       type: object
 *       description: A custom exercise.
 *       additionalProperties: false
 *       required: [name, muscle, equipment]
 *       properties:
 *         name:
 *           type: string
 *           description: Exercise name.
 *           example: Landmine Press
 *         muscle:
 *           type: string
 *           description: Muscle key from the library.
 *           example: front_delts
 *         equipment:
 *           type: string
 *           enum: [barbell, dumbbell, machine, cable, smith, bodyweight, band, other]
 *           description: Equipment type.
 *           example: barbell
 *         videoUrl:
 *           type: [string, "null"]
 *           format: uri
 *           description: Optional https link to a demo video.
 *           example: null
 *     MesocycleInput:
 *       type: object
 *       description: A mesocycle plan, from a template or explicit days.
 *       additionalProperties: false
 *       properties:
 *         name:
 *           type: string
 *           description: Name (default the template's).
 *           example: Winter bulk meso 1
 *         weeks:
 *           type: integer
 *           minimum: 3
 *           maximum: 8
 *           description: Total weeks including the final deload (default 5).
 *           example: 5
 *         startDate:
 *           type: string
 *           format: date
 *           description: First day (default today).
 *           example: "2026-10-26"
 *         template:
 *           type: string
 *           description: A template key from the library.
 *           example: upper_lower_4
 *         days:
 *           type: array
 *           description: Explicit training days; overrides the template's days.
 *           items:
 *             type: object
 *             description: One training day.
 *             properties:
 *               label:
 *                 type: string
 *                 description: Day label.
 *                 example: Upper A
 *               slots:
 *                 type: array
 *                 description: Exercise slots in order.
 *                 items:
 *                   type: object
 *                   description: One slot; the exercise defaults to the library's first for the muscle.
 *                   properties:
 *                     muscle:
 *                       type: string
 *                       description: Muscle key.
 *                       example: chest
 *                     exerciseId:
 *                       type: string
 *                       description: Exercise id from the library.
 *                       example: barbell_bench_press
 *                     exerciseName:
 *                       type: string
 *                       description: Exercise name, matched against the library when no id is given.
 *                       example: incline dumbbell press
 *           example: [{ label: Push, slots: [{ muscle: chest, exerciseId: barbell_bench_press }, { muscle: side_delts }] }]
 *         notes:
 *           type: string
 *           description: Free-text notes.
 *           example: focus on chest and side delts
 *     MesocyclePatch:
 *       type: object
 *       description: Mesocycle fields to change.
 *       additionalProperties: false
 *       properties:
 *         name:
 *           type: string
 *           description: New name.
 *           example: Winter bulk meso 1
 *         notes:
 *           type: [string, "null"]
 *           description: New notes.
 *           example: null
 *         status:
 *           type: string
 *           enum: [completed, abandoned]
 *           description: End the mesocycle early.
 *           example: completed
 *     FeedbackInput:
 *       type: object
 *       description: Feedback for one muscle in one session. Values are answer indexes.
 *       additionalProperties: false
 *       required: [week, day, muscle]
 *       properties:
 *         week:
 *           type: integer
 *           description: Week the feedback is for.
 *           example: 2
 *         day:
 *           type: integer
 *           description: Day number.
 *           example: 1
 *         muscle:
 *           type: string
 *           description: Muscle key trained that day.
 *           example: chest
 *         soreness:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 3
 *           description: 0 never got sore, 1 healed a while ago, 2 healed just on time, 3 still sore.
 *           example: 1
 *         pump:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 2
 *           description: 0 low, 1 moderate, 2 amazing.
 *           example: 1
 *         jointPain:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 3
 *           description: 0 none, 1 low, 2 moderate, 3 a lot.
 *           example: 0
 *         workload:
 *           type: [integer, "null"]
 *           minimum: 0
 *           maximum: 3
 *           description: 0 not enough, 1 just right, 2 pushed my limits, 3 too much.
 *           example: 1
 *     LogSetsInput:
 *       type: object
 *       description: Sets done on one exercise.
 *       additionalProperties: false
 *       required: [sets]
 *       properties:
 *         exercise:
 *           type: string
 *           description: Exercise name or muscle as the user said it; matched against the session.
 *           example: bench
 *         slotId:
 *           type: string
 *           description: Exact slot id, instead of a name.
 *           example: 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d
 *         mesoId:
 *           type: string
 *           description: Mesocycle (default the active one).
 *           example: 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d
 *         week:
 *           type: integer
 *           description: Week (default the next session due).
 *           example: 2
 *         day:
 *           type: integer
 *           description: Day (default the next session due).
 *           example: 1
 *         sets:
 *           type: array
 *           minItems: 1
 *           maxItems: 12
 *           description: The sets, in order.
 *           items:
 *             type: object
 *             description: One set.
 *             required: [reps]
 *             properties:
 *               weightLb:
 *                 type: number
 *                 description: Load in pounds (0 for bodyweight).
 *                 example: 185
 *               reps:
 *                 type: integer
 *                 description: Reps completed in this set.
 *                 example: 8
 *               at:
 *                 type: [string, integer]
 *                 description: >-
 *                   When the set was finished, ISO 8601 with offset or epoch ms. Omit for sets done
 *                   just now; sets sent together without times share one timestamp.
 *                 example: '2026-10-25T18:42:00-05:00'
 *           example: [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 7 }]
 *     SetPatch:
 *       type: object
 *       description: Set fields to change. Giving reps with a weight logs the set.
 *       additionalProperties: false
 *       properties:
 *         weightLb:
 *           type: [number, "null"]
 *           description: Load in pounds.
 *           example: 185
 *         reps:
 *           type: [integer, "null"]
 *           description: Reps done.
 *           example: 8
 *         done:
 *           type: boolean
 *           description: True logs the set; false un-logs it.
 *           example: true
 *         targetWeightLb:
 *           type: [number, "null"]
 *           description: Target load in pounds.
 *           example: 190
 *         targetReps:
 *           type: [integer, "null"]
 *           description: Target reps.
 *           example: 8
 *         loggedAt:
 *           type: [string, integer]
 *           description: >-
 *             When the set was finished (ISO 8601 or epoch ms); logs the set at that time. Without
 *             it, logging stamps now and editing a done set keeps its time.
 *           example: '2026-10-25T18:42:00-05:00'
 *     CompleteSessionInput:
 *       type: object
 *       description: Optional finish details.
 *       additionalProperties: false
 *       properties:
 *         at:
 *           type: [string, integer]
 *           description: When the session finished (ISO 8601 or epoch ms, default now).
 *           example: '2026-10-25T19:30:00-05:00'
 *     AddSetInput:
 *       type: object
 *       description: Where to add a set.
 *       additionalProperties: false
 *       required: [week]
 *       properties:
 *         week:
 *           type: integer
 *           description: Week number.
 *           example: 2
 *     SwapExerciseInput:
 *       type: object
 *       description: The replacement exercise.
 *       additionalProperties: false
 *       properties:
 *         exerciseId:
 *           type: string
 *           description: Id of the replacement exercise from the library.
 *           example: incline_dumbbell_press
 *         exerciseName:
 *           type: string
 *           description: Exercise name, matched against the library within the slot's muscle.
 *           example: incline dumbbell press
 *         fromWeek:
 *           type: integer
 *           description: First week to change (default 1, every unlogged set).
 *           example: 3
 *     TrainingResult:
 *       type: object
 *       description: >-
 *         A training payload (mesocycle, session, set, or operation result). Weights are pounds; see
 *         the operation description for the fields.
 *       additionalProperties: true
 *       example: { ok: true, week: 2, day: 1, exerciseName: Barbell Bench Press, muscle: chest }
 */

type Env = { Bindings: { DB: D1Database }; Variables: { email: string } };
type Ctx = Context<Env>;

const NOT_FOUND = /^no (phase|mesocycle|set|slot|exercise) with that id$/;
// A helper's result as the response: { error } maps to 404 (unknown id) or
// 400 (bad input), anything else is a 200.
const reply = (c: Ctx, r: object) => {
  const error = (r as { error?: unknown }).error;
  if (typeof error !== "string") return c.json(r);
  return c.json(r, NOT_FOUND.test(error) ? 404 : 400);
};
const body = async <T = Record<string, unknown>>(c: Ctx): Promise<T> => ((await c.req.json<T>().catch(() => null)) ?? {}) as T;
const todayOf = (c: Ctx) => {
  const d = c.req.query("date");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
};
const deleted = (c: Ctx, ok: boolean) => (ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404));

/** The phases + training routes, mounted on the main app with app.route("/", trainingRoutes). */
export const trainingRoutes = new Hono<Env>();
const app = trainingRoutes;
// ---- goal phases ---------------------------------------------------------
/**
 * @openapi
 * /api/phases:
 *   get:
 *     tags: [Phases]
 *     summary: List goal phases
 *     description: >-
 *       Returns every bulk, cut, and maintenance phase (newest first) with planned vs actual weekly
 *       rate of weight change, the open phase, and a maintenance-calorie estimate from the caller's
 *       own intake and weigh-ins (null until there are 10+ logged days across two weeks).
 *     operationId: listPhases
 *     parameters:
 *       - $ref: '#/components/parameters/Today'
 *     responses:
 *       '200':
 *         description: The caller's phases with progress and the maintenance estimate.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PhaseList'
 */
app.get("/api/phases", async (c) => c.json(await listPhasesForUser(c, c.get("email"), todayOf(c))));

/**
 * @openapi
 * /api/phases:
 *   post:
 *     tags: [Phases]
 *     summary: Start a phase
 *     description: >-
 *       Starts a bulk, cut, or maintenance phase and closes the open one. Omitted fields are filled
 *       in: start weight from the latest weigh-in, rate from the kind's default (+0.25% / -0.5% / 0%
 *       bodyweight per week), goal weight projected to the planned end, and daily calories from
 *       data-driven maintenance plus the rate's surplus or deficit. The phase's numbers are written
 *       to the caller's targets.
 *     operationId: startPhase
 *     parameters:
 *       - $ref: '#/components/parameters/Today'
 *     requestBody:
 *       required: true
 *       description: The phase to start.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhaseInput'
 *     responses:
 *       '200':
 *         description: The phase was started.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PhaseStarted'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/phases", async (c) => {
  const r = await startPhaseForUser(c, c.get("email"), await body<PhaseInput>(c), todayOf(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/phases/{id}:
 *   patch:
 *     tags: [Phases]
 *     summary: Edit a phase
 *     description: Partially updates a phase (dates, goal, rate, calories, protein, note). The kind can't change; start a new phase instead. Editing the open phase updates the targets too.
 *     operationId: updatePhase
 *     parameters:
 *       - $ref: '#/components/parameters/PhaseId'
 *       - $ref: '#/components/parameters/Today'
 *     requestBody:
 *       required: true
 *       description: The phase fields to change.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhaseInput'
 *     responses:
 *       '200':
 *         description: The updated phase.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PhaseUpdated'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.patch("/api/phases/:id", async (c) => {
  const r = await updatePhaseForUser(c, c.get("email"), c.req.param("id"), await body<PhaseInput>(c), todayOf(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/phases/{id}/end:
 *   post:
 *     tags: [Phases]
 *     summary: End a phase
 *     description: Closes the open phase on the given day (default today) without starting another.
 *     operationId: endPhase
 *     parameters:
 *       - $ref: '#/components/parameters/PhaseId'
 *       - $ref: '#/components/parameters/Today'
 *     responses:
 *       '200':
 *         description: The phase was ended.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.post("/api/phases/:id/end", async (c) => {
  const r = await endPhaseForUser(c, c.get("email"), c.req.param("id"), todayOf(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/phases/{id}:
 *   delete:
 *     tags: [Phases]
 *     summary: Delete a phase
 *     description: Permanently removes a phase from the history. Targets are left as they are.
 *     operationId: deletePhase
 *     parameters:
 *       - $ref: '#/components/parameters/PhaseId'
 *     responses:
 *       '200':
 *         description: The phase was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/phases/:id", async (c) => {
  return deleted(c, await deletePhaseForUser(c, c.get("email"), c.req.param("id")));
});

// ---- training library ----------------------------------------------------
/**
 * @openapi
 * /api/training/library:
 *   get:
 *     tags: [Training]
 *     summary: Training library
 *     description: >-
 *       Everything needed to build a mesocycle: muscle groups with their weekly volume landmarks
 *       (MV, MEV, MAV, MRV hard sets), equipment types, split templates, the feedback questions and
 *       answers, and the exercise library (built-in plus the caller's own exercises).
 *     operationId: getTrainingLibrary
 *     parameters:
 *       - name: muscle
 *         in: query
 *         required: false
 *         description: Only return exercises for this muscle key.
 *         schema:
 *           type: string
 *           example: chest
 *     responses:
 *       '200':
 *         description: The library.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingLibrary'
 */
app.get("/api/training/library", async (c) =>
  c.json({
    muscles: MUSCLES,
    equipment: EQUIPMENT,
    templates: TEMPLATES,
    feedbackScales: FEEDBACK_SCALES,
    exercises: await listExercisesForUser(c, c.get("email"), c.req.query("muscle") || undefined),
  }),
);

/**
 * @openapi
 * /api/training/exercises:
 *   post:
 *     tags: [Training]
 *     summary: Add a custom exercise
 *     description: Adds an exercise to the caller's library so it can be picked in a mesocycle.
 *     operationId: createExercise
 *     requestBody:
 *       required: true
 *       description: The exercise.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExerciseInput'
 *     responses:
 *       '200':
 *         description: The exercise was created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/training/exercises", async (c) => {
  const r = await createExerciseForUser(c, c.get("email"), await body(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/exercises/{id}:
 *   delete:
 *     tags: [Training]
 *     summary: Delete a custom exercise
 *     description: Removes one of the caller's custom exercises. Mesocycles already using it keep their copy of the name.
 *     operationId: deleteExercise
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     responses:
 *       '200':
 *         description: The exercise was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/training/exercises/:id", async (c) => {
  return deleted(c, await deleteExerciseForUser(c, c.get("email"), c.req.param("id")));
});

// ---- mesocycles ----------------------------------------------------------
/**
 * @openapi
 * /api/training/mesocycles:
 *   get:
 *     tags: [Training]
 *     summary: List mesocycles
 *     description: Every mesocycle (newest first) with its progress and week-by-day calendar, plus the active one.
 *     operationId: listMesocycles
 *     responses:
 *       '200':
 *         description: The caller's mesocycles.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 */
app.get("/api/training/mesocycles", async (c) => c.json(await listMesocyclesForUser(c, c.get("email"))));

/**
 * @openapi
 * /api/training/mesocycles:
 *   post:
 *     tags: [Training]
 *     summary: Create a mesocycle
 *     description: >-
 *       Plans a mesocycle from a split template or explicit days of muscle slots. The last week is a
 *       deload. Week 1 starts each muscle at its MEV split across its slots, at 3 reps in reserve;
 *       later weeks are planned from what was lifted and the per-muscle feedback. One mesocycle can
 *       be active at a time.
 *     operationId: createMesocycle
 *     parameters:
 *       - $ref: '#/components/parameters/Today'
 *     requestBody:
 *       required: true
 *       description: The plan.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MesocycleInput'
 *     responses:
 *       '200':
 *         description: The created mesocycle.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/training/mesocycles", async (c) => {
  const r = await createMesocycleForUser(c, c.get("email"), await body(c), todayOf(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/current:
 *   get:
 *     tags: [Training]
 *     summary: Next workout
 *     description: The active mesocycle's next session due (the first week/day not yet completed) with its exercises, sets, targets, last week's results, and feedback.
 *     operationId: getCurrentSession
 *     responses:
 *       '200':
 *         description: The next session, or active false when no mesocycle is running.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 */
app.get("/api/training/current", async (c) => c.json(await currentSessionForUser(c, c.get("email"))));

/**
 * @openapi
 * /api/training/mesocycles/{id}:
 *   get:
 *     tags: [Training]
 *     summary: Get a mesocycle
 *     description: One mesocycle with its calendar, day plans (slots), and planned sets per muscle per week beside each muscle's landmarks.
 *     operationId: getMesocycle
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     responses:
 *       '200':
 *         description: The mesocycle.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.get("/api/training/mesocycles/:id", async (c) => {
  const m = await getMesocycleForUser(c, c.get("email"), c.req.param("id"));
  return m ? c.json(m) : c.json({ error: "not found" }, 404);
});

/**
 * @openapi
 * /api/training/mesocycles/{id}:
 *   patch:
 *     tags: [Training]
 *     summary: Edit or end a mesocycle
 *     description: Renames it, edits its notes, or ends it early with status completed or abandoned.
 *     operationId: updateMesocycle
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     requestBody:
 *       required: true
 *       description: The mesocycle fields to change.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MesocyclePatch'
 *     responses:
 *       '200':
 *         description: The updated mesocycle.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.patch("/api/training/mesocycles/:id", async (c) => {
  const r = await updateMesocycleForUser(c, c.get("email"), c.req.param("id"), await body(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/mesocycles/{id}:
 *   delete:
 *     tags: [Training]
 *     summary: Delete a mesocycle
 *     description: Permanently deletes a mesocycle and its sets and feedback. Workouts its completed sessions logged stay in the workout history.
 *     operationId: deleteMesocycle
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     responses:
 *       '200':
 *         description: The mesocycle was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/training/mesocycles/:id", async (c) => {
  return deleted(c, await deleteMesocycleForUser(c, c.get("email"), c.req.param("id")));
});

/**
 * @openapi
 * /api/training/mesocycles/{id}/sessions/{week}/{day}:
 *   get:
 *     tags: [Training]
 *     summary: Get a session
 *     description: >-
 *       One training session (week + day number) with its exercises, sets, targets, last week's
 *       results, and per-muscle feedback. Each set carries loggedAt (when it was finished, epoch ms)
 *       and restS (seconds since the previous set in the session finished, null when unknown);
 *       progress has sets / reps / volume done so far, startedAt, lastSetAt, elapsedS, and
 *       avgRestS. A later week not yet planned is planned on read from the week before.
 *     operationId: getSession
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *       - $ref: '#/components/parameters/Week'
 *       - $ref: '#/components/parameters/Day'
 *     responses:
 *       '200':
 *         description: The session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.get("/api/training/mesocycles/:id/sessions/:week/:day", async (c) => {
  const r = await getSessionForUser(c, c.get("email"), c.req.param("id"), Number(c.req.param("week")), Number(c.req.param("day")));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/mesocycles/{id}/sessions/{week}/{day}/complete:
 *   post:
 *     tags: [Training]
 *     summary: Finish a session
 *     description: >-
 *       Marks the session done, logs it as a strength workout in the workout history, and plans the
 *       same day next week from this week's results and feedback. Finishing the last session
 *       completes the mesocycle.
 *     operationId: completeSession
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *       - $ref: '#/components/parameters/Week'
 *       - $ref: '#/components/parameters/Day'
 *     requestBody:
 *       required: false
 *       description: Optional, when the session finished if not now.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CompleteSessionInput'
 *     responses:
 *       '200':
 *         description: The session was completed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.post("/api/training/mesocycles/:id/sessions/:week/:day/complete", async (c) => {
  const b = await body<{ at?: unknown }>(c);
  const r = await completeSessionForUser(c, c.get("email"), c.req.param("id"), Number(c.req.param("week")), Number(c.req.param("day")), b.at);
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/mesocycles/{id}/feedback:
 *   put:
 *     tags: [Training]
 *     summary: Rate a muscle
 *     description: >-
 *       Records feedback for one muscle in one session, the input to next week's set progression.
 *       Soreness (asked before the muscle's first exercise) is how it recovered since it was last
 *       trained; pump, joint pain, and workload are asked after its last exercise. Each is the index
 *       of an answer in the library's feedbackScales.
 *     operationId: setFeedback
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     requestBody:
 *       required: true
 *       description: The feedback.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeedbackInput'
 *     responses:
 *       '200':
 *         description: The feedback was saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.put("/api/training/mesocycles/:id/feedback", async (c) => {
  const r = await setFeedbackForUser(c, c.get("email"), c.req.param("id"), await body(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/log:
 *   post:
 *     tags: [Training]
 *     summary: Log sets by exercise
 *     description: >-
 *       Logs sets the way a person says them ("bench 185 for 8, 8, 7"): finds the exercise in a
 *       session (default the active mesocycle's next one) by name or muscle, fills its unlogged sets
 *       in order, and adds sets when more were done than planned.
 *     operationId: logTrainingSets
 *     requestBody:
 *       required: true
 *       description: The exercise and the sets done.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LogSetsInput'
 *     responses:
 *       '200':
 *         description: The sets were logged.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/training/log", async (c) => {
  const r = await logSetsForUser(c, c.get("email"), await body(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/sets/{id}:
 *   patch:
 *     tags: [Training]
 *     summary: Log or edit a set
 *     description: Sets a set's weight and reps (logging it), un-logs it with done false, or edits its targets.
 *     operationId: updateSet
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     requestBody:
 *       required: true
 *       description: The set fields to log or change.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetPatch'
 *     responses:
 *       '200':
 *         description: The updated set.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.patch("/api/training/sets/:id", async (c) => {
  const r = await updateSetForUser(c, c.get("email"), c.req.param("id"), await body(c));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/sets/{id}:
 *   delete:
 *     tags: [Training]
 *     summary: Delete a set
 *     description: Removes one set from a session.
 *     operationId: deleteSet
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     responses:
 *       '200':
 *         description: The set was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/training/sets/:id", async (c) => {
  return deleted(c, await deleteSetForUser(c, c.get("email"), c.req.param("id")));
});

/**
 * @openapi
 * /api/training/slots/{id}/sets:
 *   post:
 *     tags: [Training]
 *     summary: Add a set
 *     description: Adds a set to an exercise slot for one week, copying the last set's targets.
 *     operationId: addSet
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     requestBody:
 *       required: true
 *       description: The week to add the set to.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddSetInput'
 *     responses:
 *       '200':
 *         description: The new set.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.post("/api/training/slots/:id/sets", async (c) => {
  const b = await body<{ week?: unknown }>(c);
  const r = await addSetForUser(c, c.get("email"), c.req.param("id"), Number(b.week));
  return reply(c, r);
});

/**
 * @openapi
 * /api/training/slots/{id}:
 *   patch:
 *     tags: [Training]
 *     summary: Swap an exercise
 *     description: Replaces a slot's exercise from the given week on (default all unlogged weeks). Logged sets keep the exercise they were done with.
 *     operationId: swapExercise
 *     parameters:
 *       - $ref: '#/components/parameters/TrainingId'
 *     requestBody:
 *       required: true
 *       description: The replacement exercise, by id or name.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapExerciseInput'
 *     responses:
 *       '200':
 *         description: The exercise was swapped.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrainingResult'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.patch("/api/training/slots/:id", async (c) => {
  const b = await body<{ exerciseId?: unknown; exerciseName?: unknown; fromWeek?: unknown }>(c);
  const r = await swapExerciseForUser(c, c.get("email"), c.req.param("id"), b, b.fromWeek != null ? Number(b.fromWeek) : 1);
  return reply(c, r);
});
