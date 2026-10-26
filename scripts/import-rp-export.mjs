#!/usr/bin/env node
// Import an RP Hypertrophy "Export your training data" archive into skcal's
// mesocycle tables. RP has no CSV/JSON API, so the only portable copy is the
// zip the app writes from Profile → Your data → Export (it contains
// rp-training-data.json). This script turns that file into idempotent SQL for
// D1: every id is derived from the RP ids, so re-running the import can't
// duplicate a mesocycle or a set.
//
//   node scripts/import-rp-export.mjs rp-training-data.json > rp-import.sql
//   npx wrangler d1 execute telemetry-db --remote --file rp-import.sql
//
// Units: RP exports pounds, which is what meso_sets stores. Sets that RP
// marked "skipped" are kept with their numbers but no logged_at, so they count
// as planned-not-done exactly like a skipped set in the app.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const USER_EMAIL = process.env.SKCAL_EMAIL || "me@skeptrune.com";

// RP's muscle_group ids (see the app bundle): 1 chest … 12 abs.
const RP_MUSCLE = {
  1: "chest",
  2: "back",
  3: "triceps",
  4: "biceps",
  5: "shoulders",
  6: "quads",
  7: "glutes",
  8: "hamstrings",
  9: "calves",
  10: "traps",
  11: "forearms",
  12: "abs",
};

// RP models shoulders as one group; skcal splits it. Classify by movement.
function deltFor(name) {
  const n = name.toLowerCase();
  if (n.includes("shrug")) return "traps";
  if (n.includes("facepull") || n.includes("face pull") || n.includes("rear delt") || n.includes("reverse fly")) return "rear_delts";
  if (n.includes("front raise")) return "front_delts";
  if (n.includes("press") || n.includes("arnold")) return "front_delts";
  if (n.includes("lateral") || n.includes("y raise")) return "side_delts";
  return "side_delts";
}

function muscleFor(groupId, name) {
  const m = RP_MUSCLE[groupId];
  if (!m) return "chest";
  return m === "shoulders" ? deltFor(name) : m;
}

function equipmentFor(name) {
  const n = name.toLowerCase();
  if (n.startsWith("barbell") || n.includes("barbell")) return "barbell";
  if (n.startsWith("smith")) return "smith";
  if (n.startsWith("cable") || n.includes("cable") || n.includes("pushdown")) return "cable";
  if (n.startsWith("dumbbell") || n.startsWith("dumbbell") || n.includes("dumbbell")) return "dumbbell";
  if (n.includes("machine") || n.includes("leg extension") || n.includes("leg curl") || n.includes("pec deck")) return "machine";
  if (n.includes("band")) return "band";
  if (n.includes("pullup") || n.includes("chinup") || n.includes("pushup") || n.includes("dip") || n.includes("hanging") || n.includes("back raise") || n.includes("nordic") || n.includes("sissy") || n.includes("inverted row")) return "bodyweight";
  return "other";
}

// Stable uuid-shaped id from a string key, so imports are idempotent.
function id(key) {
  const h = createHash("sha1").update(key).digest("hex").slice(0, 32).split("");
  h[12] = "4";
  h[16] = "8";
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" && Number.isFinite(v) ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ms = (iso) => (iso ? Date.parse(iso) : null);
const day = (iso) => (iso ? iso.slice(0, 10) : null);
const chunk = (rows, n) => rows.reduce((a, r, i) => (i % n ? a[a.length - 1].push(r) : a.push([r]), a), []);
const insert = (table, cols, rows) =>
  chunk(rows, 150)
    .map((part) => `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES\n${part.map((r) => `(${r.map((v) => (v == null ? "NULL" : v)).join(",")})`).join(",\n")};`)
    .join("\n");

const mesos = JSON.parse(readFileSync(process.argv[2] ?? "rp-training-data.json", "utf8"));
const out = [];
const exercises = new Map(); // rp name -> { id, name, muscle, equipment }

const mesoRows = [];
const dayRows = [];
const slotRows = [];
const setRows = [];
const feedbackRows = [];
const sessionRows = [];
const workoutRows = [];

for (const m of mesos) {
  const mesoId = id(`rp:meso:${m.id}`);
  const weeks = m.weeks.length;
  const dayCount = m.days;
  const rirs = String(m.microRirs ?? "");
  const created = m.createdAt;
  const status = m.status === "complete" ? "completed" : "active";
  const notes = ["Imported from RP Hypertrophy.", m.generatedFrom ? `RP template: ${m.generatedFrom}.` : "", `RP mesocycle ${m.key}.`]
    .join(" ")
    .trim();
  mesoRows.push([
    q(mesoId), q(USER_EMAIL), q(m.name.slice(0, 80)), weeks, dayCount, q(day(created)), q(status),
    q(day(m.finishedAt)), q(notes), ms(created),
  ]);

  // One meso_days row per training day, and one slot per exercise the day ever
  // held (RP lets a slot change exercise mid-meso; skcal slots are per day, so
  // the union keeps every historical set attached to its real exercise).
  const slotsByDay = new Map();
  for (const w of m.weeks) {
    for (const d of w.days) {
      const dayId = id(`rp:meso:${m.id}:day:${d.position}`);
      if (!slotsByDay.has(dayId)) slotsByDay.set(dayId, { position: d.position, label: d.label, slots: new Map() });
      const bucket = slotsByDay.get(dayId).slots;
      for (const ex of d.exercises) {
        const key = `${d.position}:${ex.position}:${ex.name}`;
        if (!bucket.has(key)) {
          const muscle = muscleFor(ex.muscleGroupId, ex.name);
          if (!exercises.has(ex.name)) {
            exercises.set(ex.name, {
              id: `c_${id(`rp:exercise:${ex.name}`)}`,
              name: ex.name.slice(0, 100),
              muscle,
              equipment: equipmentFor(ex.name),
            });
          }
          bucket.set(key, { slotId: id(`rp:slot:${m.id}:${d.position}:${ex.position}:${ex.name}`), muscle, ex });
        }
      }
    }
  }
  for (const [dayId, info] of slotsByDay) {
    dayRows.push([q(dayId), q(mesoId), q(USER_EMAIL), info.position + 1, q(info.label)]);
    let n = 0;
    for (const s of info.slots.values()) {
      n += 1;
      const e = exercises.get(s.ex.name);
      slotRows.push([q(s.slotId), q(mesoId), q(dayId), q(USER_EMAIL), n, q(s.muscle), q(e.id), q(e.name), q(e.equipment)]);
    }
  }

  m.weeks.forEach((w, wi) => {
    const week = wi + 1;
    const targetRir = /^\d$/.test(rirs[wi] ?? "") ? Number(rirs[wi]) : null;
    for (const d of w.days) {
      const dayId = id(`rp:meso:${m.id}:day:${d.position}`);
      let first = null;
      let last = null;
      const details = [];
      for (const ex of d.exercises) {
        const key = `${dayId}:${ex.position}:${ex.name}`;
        const slotId = id(`rp:slot:${m.id}:${d.position}:${ex.position}:${ex.name}`);
        const muscle = muscleFor(ex.muscleGroupId, ex.name);
        let setNo = 0;
        const done = [];
        for (const s of ex.sets) {
          setNo += 1;
          const finished = s.finishedAt ? ms(s.finishedAt) : null;
          const skipped = s.status === "skipped";
          const loggedAt = finished && !skipped ? finished : null;
          if (loggedAt) {
            first = first == null ? loggedAt : Math.min(first, loggedAt);
            last = last == null ? loggedAt : Math.max(last, loggedAt);
            done.push([s.weight, s.reps]);
          }
          setRows.push([
            q(id(`rp:set:${s.id}`)), q(mesoId), q(dayId), q(slotId), q(USER_EMAIL), week, s.position + 1,
            q(muscle), q(ex.name.slice(0, 100)),
            q(s.repsTarget ?? (s.reps > 0 ? s.reps : null)), q(s.weightTarget ?? (s.weight > 0 ? s.weight : null)), targetRir,
            q(s.weight), q(s.reps), q(loggedAt),
          ]);
        }
        if (ex.jointPain != null) feedbackRows.push([q(mesoId), q(dayId), week, q(muscle), q(USER_EMAIL), null, null, ex.jointPain, null]);
        if (done.length) details.push({ exercise: ex.name, sets: done.length, weight_lb: done[0][0], reps: done[0][1] });
      }
      // RP logs pump / soreness / workload per muscle group for the day.
      for (const g of d.muscleGroups ?? []) {
        const muscle = muscleFor(g.muscleGroupId, "");
        feedbackRows.push([
          q(mesoId), q(dayId), week, q(muscle), q(USER_EMAIL),
          g.soreness >= 0 ? g.soreness : null, g.pump >= 0 ? g.pump : null, g.workload >= 0 ? g.workload : null,
        ]);
      }
      // A skipped day still counts as "this session is behind you" in RP, so it
      // becomes a completed session with no logged sets — otherwise skcal would
      // keep pointing at a workout he deliberately skipped.
      const skipAt = d.status === "skipped" ? ms(d.finishedAt ?? d.updatedAt) : null;
      if ((d.finishedAt && first != null) || skipAt) {
        const workoutId = first != null ? id(`rp:workout:${m.id}:${week}:${d.position}`) : null;
        sessionRows.push([q(mesoId), q(dayId), week, q(USER_EMAIL), skipAt ?? ms(d.finishedAt), q(workoutId)]);
        if (workoutId) workoutRows.push([
          q(workoutId), q(USER_EMAIL), q("manual"), q(`meso:${mesoId}:${week}:${dayId}`), q("strength_training"),
          q(`${m.name} — week ${week} ${d.label ?? ""}`.trim()), q("Imported from RP Hypertrophy."), first,
          Math.round((last - first) / 1000), q(JSON.stringify(details)), ms(d.finishedAt),
        ]);
      }
    }
  });
}

out.push(`-- RP Hypertrophy import for ${USER_EMAIL}. Generated from the app's own export.`);
out.push(`-- ${mesos.length} mesocycles / ${setRows.length} sets. Idempotent: re-running is a no-op.`);
out.push(
  insert("exercises", ["id", "user_email", "name", "muscle", "equipment", "created_at"],
    [...exercises.values()].map((e) => [q(e.id), q(USER_EMAIL), q(e.name), q(e.muscle), q(e.equipment), Date.now()])),
);
out.push(insert("mesocycles", ["id", "user_email", "name", "weeks", "days_per_week", "start_date", "status", "ended_date", "notes", "created_at"], mesoRows));
out.push(insert("meso_days", ["id", "meso_id", "user_email", "position", "label"], dayRows));
out.push(insert("meso_slots", ["id", "meso_id", "day_id", "user_email", "position", "muscle", "exercise_id", "exercise_name", "equipment"], slotRows));
out.push(
  insert("meso_sets", ["id", "meso_id", "day_id", "slot_id", "user_email", "week", "position", "muscle", "exercise_name", "target_reps", "target_weight_lb", "target_rir", "weight_lb", "reps", "logged_at"], setRows),
);
// meso_feedback's primary key is (meso, day, week, muscle). RP records joint
// pain per exercise but pump/soreness/workload per muscle, so merge the two
// into one row instead of letting the day-level row drop the joint pain.
const feedbackMerged = new Map();
for (const r of feedbackRows) {
  const key = `${r[0]}:${r[1]}:${r[2]}:${r[3]}`;
  const prev = feedbackMerged.get(key) ?? [r[0], r[1], r[2], r[3], r[4], null, null, null, null];
  for (const i of [5, 6, 7, 8]) if (r[i] != null) prev[i] = r[i];
  feedbackMerged.set(key, prev);
}
out.push(
  insert("meso_feedback", ["meso_id", "day_id", "week", "muscle", "user_email", "soreness", "pump", "joint_pain", "workload"], [
    ...feedbackMerged.values(),
  ]),
);
out.push(insert("meso_sessions", ["meso_id", "day_id", "week", "user_email", "completed_at", "workout_id"], sessionRows));
out.push(
  insert("workouts", ["id", "user_email", "source", "external_id", "activity_type", "summary", "description", "started_at", "duration_s", "details", "created_at"], workoutRows),
);

process.stdout.write(out.join("\n") + "\n");
