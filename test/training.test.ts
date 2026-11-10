import { describe, expect, it } from "vitest";
import { initialSetCounts, nextSetTarget, planNextWeek, rirForWeek, sessionTiming, setDelta } from "../src/worker/training";
import { estimateTdee, kcalForRate, phaseProgress } from "../src/worker/phases";
import { workerFetch } from "./harness";

// ---- pure programming math (no worker involved) -----------------------------

describe("training: RIR schedule", () => {
  it("falls 3 → 0 across the accumulation weeks and leaves the deload untargeted", () => {
    expect([1, 2, 3, 4, 5].map((w) => rirForWeek(w, 5))).toEqual([3, 2, 1, 0, null]);
    expect([1, 2, 3, 4].map((w) => rirForWeek(w, 4))).toEqual([3, 2, 0, null]);
    expect([1, 2, 3].map((w) => rirForWeek(w, 3))).toEqual([3, 0, null]);
  });
});

describe("training: starting volume", () => {
  it("splits a muscle's MEV across its slots, at least 2 sets each", () => {
    const counts = initialSetCounts([
      { id: "a", muscle: "back" }, // back MEV 8, two slots → 4 each
      { id: "b", muscle: "back" },
      { id: "c", muscle: "front_delts" }, // MEV 2 → floor of 2
    ]);
    expect(counts.get("a")).toBe(4);
    expect(counts.get("b")).toBe(4);
    expect(counts.get("c")).toBe(2);
  });
});

describe("training: set progression from feedback", () => {
  const fb = (soreness: number | null, pump: number | null, jointPain: number | null, workload: number | null) => ({ soreness, pump, jointPain, workload });
  it("adds the most when recovered with a weak stimulus", () => expect(setDelta(fb(0, 0, 0, 0))).toBe(2));
  it("adds one when recovered with a good stimulus", () => expect(setDelta(fb(1, 2, 0, 1))).toBe(1));
  it("holds when still sore or the workload pushed limits", () => {
    expect(setDelta(fb(3, 1, 0, 1))).toBe(0);
    expect(setDelta(fb(0, 0, 0, 2))).toBe(0);
    expect(setDelta(fb(1, 1, 0, 3))).toBe(0);
  });
  it("cuts on a lot of joint pain, or still sore with too much work", () => {
    expect(setDelta(fb(0, 0, 3, 0))).toBe(-1);
    expect(setDelta(fb(3, 1, 0, 3))).toBe(-1);
  });
  it("ramps by one with no feedback", () => expect(setDelta(null)).toBe(1));
});

describe("training: load progression", () => {
  it("adds load after hitting the rep target", () => {
    expect(nextSetTarget({ targetReps: 8, targetWeightLb: 185, weightLb: 185, reps: 8 }, "barbell")).toEqual({ targetReps: 8, targetWeightLb: 190 });
    expect(nextSetTarget({ targetReps: 8, targetWeightLb: 400, weightLb: 400, reps: 9 }, "machine")).toEqual({ targetReps: 8, targetWeightLb: 410 });
  });
  it("adds a rep on bodyweight moves", () =>
    expect(nextSetTarget({ targetReps: 10, targetWeightLb: 0, weightLb: 0, reps: 10 }, "bodyweight")).toEqual({ targetReps: 11, targetWeightLb: 0 }));
  it("keeps the load and chases a rep after a near miss", () =>
    expect(nextSetTarget({ targetReps: 10, targetWeightLb: 100, weightLb: 100, reps: 9 }, "dumbbell")).toEqual({ targetReps: 10, targetWeightLb: 100 }));
  it("matches what was done after a big miss", () =>
    expect(nextSetTarget({ targetReps: 10, targetWeightLb: 100, weightLb: 100, reps: 6 }, "cable")).toEqual({ targetReps: 6, targetWeightLb: 100 }));
  it("carries targets forward when the set wasn't logged", () =>
    expect(nextSetTarget({ targetReps: 10, targetWeightLb: 50, weightLb: null, reps: null }, "cable")).toEqual({ targetReps: 10, targetWeightLb: 50 }));
});

describe("training: planning next week", () => {
  const set = (w: number, r: number) => ({ targetReps: 10, targetWeightLb: w, weightLb: w, reps: r });
  it("adds sets on the first slot of a muscle, capped at MRV", () => {
    const plan = planNextWeek(
      [
        { slotId: "s1", muscle: "chest", equipment: "barbell", sets: [set(100, 10), set(100, 10)] },
        { slotId: "s2", muscle: "chest", equipment: "dumbbell", sets: [set(40, 10), set(40, 10)] },
      ],
      new Map([["chest", { soreness: 0, pump: 0, jointPain: 0, workload: 0 }]]),
      new Map([["chest", 23]]), // chest MRV 24 → only 1 of the earned 2
      2,
      5,
    );
    expect(plan.get("s1")).toHaveLength(3);
    expect(plan.get("s2")).toHaveLength(2);
    expect(plan.get("s1")![0]).toEqual({ targetReps: 10, targetWeightLb: 105 });
  });
  it("holds a skipped muscle's sets", () => {
    const unlogged = { targetReps: 10, targetWeightLb: null, weightLb: null, reps: null };
    const plan = planNextWeek([{ slotId: "s1", muscle: "back", equipment: "cable", sets: [unlogged, unlogged] }], new Map(), new Map([["back", 2]]), 2, 5);
    expect(plan.get("s1")).toHaveLength(2);
  });
  it("halves sets and reps for the deload", () => {
    const plan = planNextWeek([{ slotId: "s1", muscle: "back", equipment: "cable", sets: [set(100, 10), set(100, 9), set(100, 8)] }], new Map(), new Map(), 5, 5);
    expect(plan.get("s1")).toEqual([
      { targetReps: 5, targetWeightLb: 100 },
      { targetReps: 5, targetWeightLb: 100 },
    ]);
  });
});

// ---- phases math -------------------------------------------------------------

const DAY = 86_400_000;
const t0 = Date.parse("2026-09-01T12:00:00Z");

describe("training: session timing", () => {
  it("times rest from the previous set anywhere in the session", () => {
    const t0 = 1_700_000_000_000;
    // Set 2 was done first; set 3 isn't done yet.
    const t = sessionTiming([t0 + 150_000, t0, null, t0 + 330_000]);
    expect(t.restS).toEqual([150, null, null, 180]);
    expect(t).toMatchObject({ startedAt: t0, lastSetAt: t0 + 330_000, elapsedS: 330, avgRestS: 165 });
  });
  it("leaves rest unknown for sets logged together", () => {
    const t = sessionTiming([5, 5, 5]);
    expect(t.restS).toEqual([null, null, null]);
    expect(t).toMatchObject({ elapsedS: null, avgRestS: null });
  });
  it("doesn't call a multi-hour gap a rest period", () => {
    // Imported histories break a session across days; a 20-hour "rest" would
    // otherwise dominate the average.
    const t = sessionTiming([t0, t0 + 120_000, t0 + 20 * 3_600_000, t0 + 20 * 3_600_000 + 90_000]);
    expect(t.restS).toEqual([null, 120, null, 90]);
    expect(t.avgRestS).toBe(105);
  });
});

describe("phases: maintenance estimate", () => {
  it("is average intake minus the energy in the weight gained", () => {
    // 3000 kcal/day while gaining 0.1 kg/day (770 kcal/day) → ~2230 maintenance.
    const intake = Array.from({ length: 21 }, (_, i) => ({ date: new Date(t0 + i * DAY).toISOString().slice(0, 10), kcal: 3000 }));
    const weights = Array.from({ length: 21 }, (_, i) => ({ t: t0 + i * DAY, kg: 70 + 0.1 * i }));
    expect(estimateTdee(intake, weights)).toEqual({ kcal: 2230, days: 21 });
  });
  it("needs enough data", () => {
    expect(estimateTdee([{ date: "2026-09-01", kcal: 2000 }], [{ t: t0, kg: 70 }])).toBeNull();
  });
  it("kcalForRate adds the weekly surplus per day", () => {
    // +0.5%/wk at 80 kg = 0.4 kg/wk = 440 kcal/day.
    expect(kcalForRate(2500, 80, 0.5)).toBe(2940);
  });
});

describe("phases: progress", () => {
  const phase = {
    id: "p",
    userEmail: "x",
    kind: "bulk" as const,
    startDate: "2026-09-01",
    plannedEndDate: "2026-11-24",
    endedDate: null,
    startWeightKg: 70,
    goalWeightKg: null,
    ratePctPerWeek: 0.5,
    dailyKcalTarget: null,
    proteinTargetG: null,
    note: null,
    createdAt: new Date(),
  };
  it("is on track at the planned rate and too fast at double it", () => {
    const at = (kgPerWeek: number) => Array.from({ length: 22 }, (_, i) => ({ t: t0 + i * DAY, kg: 70 + (kgPerWeek / 7) * i }));
    expect(phaseProgress(phase, at(0.35), "2026-09-22").status).toBe("on_track");
    expect(phaseProgress(phase, at(0.7), "2026-09-22").status).toBe("too_fast");
    expect(phaseProgress(phase, at(0), "2026-09-22").status).toBe("too_slow");
    expect(phaseProgress(phase, at(0.35), "2026-09-22").weeksPlanned).toBe(12);
  });
});

// ---- end to end over the Worker ----------------------------------------------

function as(email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  if (init.body) headers.set("content-type", "application/json");
  return workerFetch(path, { ...init, headers });
}
const json = async <T>(res: Response) => (await res.json()) as T;

type Session = {
  meso: { id: string };
  week: number;
  day: number;
  targetRir: number | null;
  exercises: { slotId: string; muscle: string; exerciseName: string; sets: { id: string; done: boolean; targetReps: number; targetWeightLb: number | null }[] }[];
};

describe("training API", () => {
  const user = "lifter@example.com";

  it("plans, logs, rates, and progresses a mesocycle", async () => {
    const lib = await json<{ templates: { key: string }[]; muscles: { key: string }[] }>(await as(user, "/api/training/library"));
    expect(lib.templates.map((t) => t.key)).toContain("upper_lower_4");

    const created = await as(user, "/api/training/mesocycles?date=2026-10-26", {
      method: "POST",
      body: JSON.stringify({ template: "upper_lower_4", weeks: 5 }),
    });
    expect(created.status).toBe(200);
    const meso = (await json<{ mesocycle: { id: string; calendar: unknown[]; daysPerWeek: number } }>(created)).mesocycle;
    expect(meso.daysPerWeek).toBe(4);
    expect(meso.calendar).toHaveLength(5);

    // Only one active mesocycle at a time.
    const second = await as(user, "/api/training/mesocycles", { method: "POST", body: JSON.stringify({ template: "ppl_3" }) });
    expect(second.status).toBe(400);

    const cur = await json<{ active: boolean; session: Session }>(await as(user, "/api/training/current"));
    expect(cur.active).toBe(true);
    expect(cur.session).toMatchObject({ week: 1, day: 1, targetRir: 3 });
    const bench = cur.session.exercises.find((e) => e.muscle === "chest")!;

    // Log by name, the way the agent does, with one set more than planned.
    const planned = bench.sets.length;
    const sets = Array.from({ length: planned + 1 }, () => ({ weight_lb: 185, reps: 10 }));
    const logged = await as(user, "/api/training/log", { method: "POST", body: JSON.stringify({ exercise: "bench", sets }) });
    expect(logged.status).toBe(200);
    expect((await json<{ logged: unknown[] }>(logged)).logged).toHaveLength(planned + 1);

    const fb = await as(user, `/api/training/mesocycles/${meso.id}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ week: 1, day: 1, muscle: "chest", soreness: 0, pump: 0, jointPain: 0, workload: 0 }),
    });
    expect(fb.status).toBe(200);
    const badFb = await as(user, `/api/training/mesocycles/${meso.id}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ week: 1, day: 1, muscle: "chest", pump: 9 }),
    });
    expect(badFb.status).toBe(400);

    const done = await as(user, `/api/training/mesocycles/${meso.id}/sessions/1/1/complete`, { method: "POST" });
    expect(done.status).toBe(200);
    expect((await json<{ next: { week: number; day: number } }>(done)).next).toEqual({ week: 1, day: 2, label: "Lower A" });

    // Next week's Upper A: chest earned +2 sets and +5 lb.
    const w2 = await json<Session>(await as(user, `/api/training/mesocycles/${meso.id}/sessions/2/1`));
    expect(w2.targetRir).toBe(2);
    const bench2 = w2.exercises.find((e) => e.slotId === bench.slotId)!;
    expect(bench2.sets).toHaveLength(planned + 1 + 2);
    expect(bench2.sets[0].targetWeightLb).toBe(190);

    // The finished session shows up as a regular workout too.
    const workouts = await json<{ summary: string; activityType: string }[]>(await as(user, `/api/workouts?date=${new Date().toISOString().slice(0, 10)}`));
    expect(workouts.some((w) => w.activityType === "strength_training" && w.summary.includes("week 1 day 1"))).toBe(true);

    // Other users can't see it.
    expect((await as("someone-else@example.com", `/api/training/mesocycles/${meso.id}`)).status).toBe(404);

    expect((await as(user, `/api/training/mesocycles/${meso.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json<{ active: boolean }>(await as(user, "/api/training/current"))).active).toBe(false);
  });
});

describe("training API: timing", () => {
  const user = "timed@example.com";

  it("records when each set was done, the rests between them, and the workout's length", async () => {
    const created = await as(user, "/api/training/mesocycles", { method: "POST", body: JSON.stringify({ template: "full_body_3", weeks: 4 }) });
    const mesoId = (await json<{ mesocycle: { id: string } }>(created)).mesocycle.id;
    type Timed = Session & {
      progress: { setsDone: number; volumeLb: number; startedAt: number | null; elapsedS: number | null; avgRestS: number | null };
      exercises: { slotId: string; sets: { id: string; loggedAt: number | null; restS: number | null }[] }[];
    };
    const s1 = (await json<{ session: Timed }>(await as(user, "/api/training/current"))).session;
    const [a, b] = s1.exercises[0].sets;
    const t0 = Date.now() - 60 * 60_000;

    // One set at a given time, the next 2.5 minutes later.
    const one = await as(user, `/api/training/sets/${a.id}`, { method: "PATCH", body: JSON.stringify({ weightLb: 100, reps: 10, loggedAt: t0 }) });
    expect((await json<{ set: { loggedAt: number } }>(one)).set.loggedAt).toBe(t0);
    await as(user, `/api/training/sets/${b.id}`, { method: "PATCH", body: JSON.stringify({ weightLb: 100, reps: 9, loggedAt: new Date(t0 + 150_000).toISOString() }) });

    // Fixing a done set's numbers keeps when it was done.
    const fixed = await as(user, `/api/training/sets/${a.id}`, { method: "PATCH", body: JSON.stringify({ weightLb: 105, reps: 10 }) });
    expect((await json<{ set: { loggedAt: number } }>(fixed)).set.loggedAt).toBe(t0);
    expect((await as(user, `/api/training/sets/${a.id}`, { method: "PATCH", body: JSON.stringify({ loggedAt: Date.now() + 3_600_000 }) })).status).toBe(400);

    // Sets reported together share one time: their rest is unknown.
    const second = s1.exercises[1];
    await as(user, "/api/training/log", { method: "POST", body: JSON.stringify({ slotId: second.slotId, sets: [{ weightLb: 50, reps: 12 }, { weightLb: 50, reps: 12 }] }) });

    const s2 = await json<Timed>(await as(user, `/api/training/mesocycles/${mesoId}/sessions/1/1`));
    const rests = s2.exercises.slice(0, 2).map((e) => e.sets.filter((x) => x.loggedAt).map((x) => x.restS));
    expect(rests[0]).toEqual([null, 150]);
    expect(rests[1][1]).toBeNull();
    expect(s2.progress).toMatchObject({ setsDone: 4, volumeLb: 105 * 10 + 100 * 9 + 50 * 24, startedAt: t0 });

    // Finishing writes the workout from the first set's time, for first-to-last set.
    const done = await json<{ completed: { startedAt: number; elapsedS: number } }>(
      await as(user, `/api/training/mesocycles/${mesoId}/sessions/1/1/complete`, { method: "POST", body: JSON.stringify({ at: Date.now() }) }),
    );
    expect(done.completed.startedAt).toBe(t0);
    const day = new Date(t0).toISOString().slice(0, 10);
    const workouts = await json<{ startedAt: number | string; durationS: number | null; activityType: string }[]>(await as(user, `/api/workouts?date=${day}`));
    const w = workouts.find((x) => x.activityType === "strength_training")!;
    expect(new Date(w.startedAt).getTime()).toBe(t0);
    expect(w.durationS).toBe(done.completed.elapsedS);
  });
});

describe("training API: reopening a finished session", () => {
  const user = "reopen@example.com";

  it("removes the logged workout, keeps the sets, and lets the session be finished again", async () => {
    const created = await as(user, "/api/training/mesocycles", { method: "POST", body: JSON.stringify({ template: "full_body_3", weeks: 4 }) });
    const mesoId = (await json<{ mesocycle: { id: string } }>(created)).mesocycle.id;
    const url = (action: string) => `/api/training/mesocycles/${mesoId}/sessions/1/1/${action}`;
    const today = new Date().toISOString().slice(0, 10);
    const strength = async () =>
      (await json<{ summary: string; activityType: string }[]>(await as(user, `/api/workouts?date=${today}`))).filter(
        (w) => w.activityType === "strength_training" && w.summary.includes("week 1 day 1"),
      );

    expect((await as(user, url("uncomplete"), { method: "POST" })).status).toBe(400); // not complete yet

    await as(user, "/api/training/log", { method: "POST", body: JSON.stringify({ exercise: "bench", sets: [{ weight_lb: 135, reps: 10 }] }) });
    expect((await as(user, url("complete"), { method: "POST" })).status).toBe(200);
    expect(await strength()).toHaveLength(1);

    const reopened = await as(user, url("uncomplete"), { method: "POST" });
    expect(reopened.status).toBe(200);
    expect(await json<{ next: { week: number; day: number } }>(reopened)).toMatchObject({ ok: true, next: { week: 1, day: 1 }, mesoReopened: false });
    expect(await strength()).toHaveLength(0);

    const session = await json<{ completed: boolean; progress: { setsDone: number } }>(await as(user, `/api/training/mesocycles/${mesoId}/sessions/1/1`));
    expect(session.completed).toBe(false);
    expect(session.progress.setsDone).toBe(1);

    // Finishing again works and logs exactly one workout.
    expect((await as(user, url("complete"), { method: "POST" })).status).toBe(200);
    expect(await strength()).toHaveLength(1);

    expect((await as("someone-else@example.com", url("uncomplete"), { method: "POST" })).status).toBe(404);
  });

  it("reactivates a mesocycle that only finished because of this session", async () => {
    const created = await as("reopen-meso@example.com", "/api/training/mesocycles", { method: "POST", body: JSON.stringify({ template: "full_body_3", weeks: 4 }) });
    const mesoId = (await json<{ mesocycle: { id: string } }>(created)).mesocycle.id;
    const u = "reopen-meso@example.com";
    for (let week = 1; week <= 4; week++)
      for (const day of [1, 2, 3]) expect((await as(u, `/api/training/mesocycles/${mesoId}/sessions/${week}/${day}/complete`, { method: "POST" })).status).toBe(200);
    expect((await json<{ active: boolean }>(await as(u, "/api/training/current"))).active).toBe(false);

    const r = await as(u, `/api/training/mesocycles/${mesoId}/sessions/4/3/uncomplete`, { method: "POST" });
    expect(await json<{ mesoReopened: boolean; next: { week: number; day: number } }>(r)).toMatchObject({ mesoReopened: true, next: { week: 4, day: 3 } });
    expect((await json<{ active: boolean }>(await as(u, "/api/training/current"))).active).toBe(true);
  });
});

describe("training API: editing the plan", () => {
  const user = "planner@example.com";
  type Detail = {
    id: string;
    daysPerWeek: number;
    sessionsTotal: number;
    next: { week: number; day: number } | null;
    calendar: { week: number; days: { day: number; scheduled: boolean }[] }[];
    days: { id: string; day: number; label: string | null; firstWeek: number; slots: { id: string; muscle: string }[] }[];
  };
  const detail = async (id: string) => json<Detail>(await as(user, `/api/training/mesocycles/${id}`));

  it("adds, edits, and deletes training days and their exercises", async () => {
    const created = await as(user, "/api/training/mesocycles", { method: "POST", body: JSON.stringify({ template: "ppl_3", weeks: 5 }) });
    const mesoId = (await json<{ mesocycle: { id: string } }>(created)).mesocycle.id;
    for (const day of [1, 2, 3]) expect((await as(user, `/api/training/mesocycles/${mesoId}/sessions/1/${day}/complete`, { method: "POST" })).status).toBe(200);

    // A day added in week 2 starts there: week 1 isn't a skipped session.
    const added = await as(user, `/api/training/mesocycles/${mesoId}/days`, {
      method: "POST",
      body: JSON.stringify({ label: "Arms", position: 2, slots: [{ muscle: "biceps" }, { muscle: "triceps" }] }),
    });
    expect(added.status).toBe(200);
    const arms = (await json<{ day: { id: string; day: number; firstWeek: number } }>(added)).day;
    expect(arms).toMatchObject({ day: 2, firstWeek: 2 });
    let m = await detail(mesoId);
    expect(m.daysPerWeek).toBe(4);
    expect(m.days.map((d) => d.label)).toEqual(["Push", "Arms", "Pull", "Legs"]);
    expect(m.sessionsTotal).toBe(3 * 5 + 4);
    expect(m.calendar[0].days.find((d) => d.day === 2)!.scheduled).toBe(false);
    expect(m.next).toEqual({ week: 2, day: 1, label: "Push" });
    expect((await as(user, `/api/training/mesocycles/${mesoId}/sessions/1/2`)).status).toBe(400);
    const armsW2 = await json<Session>(await as(user, `/api/training/mesocycles/${mesoId}/sessions/2/2`));
    expect(armsW2.exercises.map((e) => e.muscle)).toEqual(["biceps", "triceps"]);
    expect(armsW2.exercises.every((e) => e.sets.length >= 2)).toBe(true);

    // Rename and move it.
    const moved = await as(user, `/api/training/days/${arms.id}`, { method: "PATCH", body: JSON.stringify({ label: "Arms + delts", position: 4 }) });
    expect(moved.status).toBe(200);
    m = await detail(mesoId);
    expect(m.days.map((d) => [d.day, d.label])).toEqual([
      [1, "Push"],
      [2, "Pull"],
      [3, "Legs"],
      [4, "Arms + delts"],
    ]);

    // Add an exercise to Push: it gets sets in the planned, unfinished week 2, not finished week 1.
    const push = m.days[0];
    const slotRes = await as(user, `/api/training/days/${push.id}/slots`, { method: "POST", body: JSON.stringify({ muscle: "side_delts", position: 1 }) });
    expect(slotRes.status).toBe(200);
    const slot = (await json<{ slot: { slotId: string; position: number }; weeksPlanned: number[] }>(slotRes));
    expect(slot.weeksPlanned).toEqual([2]);
    const pushW2 = await json<Session>(await as(user, `/api/training/mesocycles/${mesoId}/sessions/2/1`));
    expect(pushW2.exercises[0]).toMatchObject({ slotId: slot.slot.slotId, muscle: "side_delts" });
    expect(pushW2.exercises[0].sets.length).toBeGreaterThan(0);

    // Remove it again; a day's only exercise can't go.
    expect((await as(user, `/api/training/slots/${slot.slot.slotId}`, { method: "DELETE" })).status).toBe(200);
    expect((await json<Session>(await as(user, `/api/training/mesocycles/${mesoId}/sessions/2/1`))).exercises.some((e) => e.slotId === slot.slot.slotId)).toBe(false);

    // Delete a day that has a finished session: the rest renumber, its workout stays.
    const pull = m.days[1];
    const del = await as(user, `/api/training/days/${pull.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await json<{ deleted: { sessionsDone: number } }>(del)).deleted.sessionsDone).toBe(1);
    m = await detail(mesoId);
    expect(m.days.map((d) => [d.day, d.label])).toEqual([
      [1, "Push"],
      [2, "Legs"],
      [3, "Arms + delts"],
    ]);
    expect(m.daysPerWeek).toBe(3);
    expect((await as(user, `/api/training/days/${pull.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await as("someone-else@example.com", `/api/training/days/${m.days[0].id}`, { method: "DELETE" })).status).toBe(404);

    // Deleting down to one day works; the last day can't go.
    await as(user, `/api/training/days/${m.days[1].id}`, { method: "DELETE" });
    await as(user, `/api/training/days/${m.days[2].id}`, { method: "DELETE" });
    m = await detail(mesoId);
    expect(m.days).toHaveLength(1);
    expect((await as(user, `/api/training/days/${m.days[0].id}`, { method: "DELETE" })).status).toBe(400);
  });
});

describe("phases API", () => {
  const user = "bulker@example.com";
  it("starts a bulk, mirrors it into targets, and closes it on the next phase", async () => {
    await as(user, "/api/weight", { method: "POST", body: JSON.stringify({ weightKg: 75 }) });
    const res = await as(user, "/api/phases?date=2026-10-24", {
      method: "POST",
      body: JSON.stringify({ kind: "bulk", plannedEndDate: "2027-01-16", dailyKcal: 2900, proteinG: 170 }),
    });
    expect(res.status).toBe(200);
    const started = await json<{ phase: { id: string; ratePctPerWeek: number; goalWeightLb: number; startWeightLb: number }; kcalSource: string }>(res);
    expect(started.phase.ratePctPerWeek).toBe(0.25);
    expect(started.kcalSource).toBe("given");
    expect(started.phase.goalWeightLb).toBeGreaterThan(started.phase.startWeightLb);

    const targets = await json<{ dailyKcalTarget: number; proteinTargetG: number }>(await as(user, "/api/targets"));
    expect(targets).toMatchObject({ dailyKcalTarget: 2900, proteinTargetG: 170 });

    const bad = await as(user, "/api/phases", { method: "POST", body: JSON.stringify({ kind: "cut", ratePctPerWeek: 0.5 }) });
    expect(bad.status).toBe(400);

    await as(user, "/api/phases?date=2027-01-17", { method: "POST", body: JSON.stringify({ kind: "maintain" }) });
    const list = await json<{ active: { kind: string }; phases: { id: string; endedDate: string | null }[] }>(await as(user, "/api/phases?date=2027-01-17"));
    expect(list.active.kind).toBe("maintain");
    expect(list.phases.find((p) => p.id === started.phase.id)!.endedDate).toBe("2027-01-16");

    const dash = await json<{ phase: { kind: string } | null }>(await as(user, "/api/dashboard"));
    expect(dash.phase?.kind).toBe("maintain");
  });
});
