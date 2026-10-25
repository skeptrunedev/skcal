import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, MoreVertical, Plus, X } from "lucide-react";
import type { FeedbackScales, MesoDetail, MesoSummary, MuscleFeedback, TrainingLibrary, TrainingSession, TrainingSet } from "../shared/types";
import { api, todayLocal, type MesoPlanDay } from "./api";
import { Select } from "./Select";

// RP Hypertrophy-style training: the active mesocycle's workout (week / day
// header, exercise cards with weight · reps · log rows, soreness before a
// muscle and pump / joint pain / workload after it), the mesocycle's plan
// (calendar + weekly sets per muscle vs its landmarks), and planning a new
// one. Everything here is also reachable through the agent and the API.

type Tab = "workout" | "plan" | "mesocycles";

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
// The live rest clock stops counting after this long: the session was left open.
const REST_CLOCK_MAX_S = 30 * 60;

/** Re-renders every second while `on`, for the live rest clock. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const label = (lib: TrainingLibrary | null, muscle: string) =>
  lib?.muscles.find((m) => m.key === muscle)?.label ?? muscle.replace(/_/g, " ");

export function Train() {
  const [lib, setLib] = useState<TrainingLibrary | null>(null);
  const [list, setList] = useState<{ mesocycles: MesoSummary[]; active: MesoSummary | null } | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [tab, setTab] = useState<Tab>("workout");
  const [planning, setPlanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, cur] = await Promise.all([api.mesocycles(), api.currentSession()]);
      setList(l);
      setSession(cur.active ? cur.session : null);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);
  useEffect(() => {
    load();
    api.trainingLibrary().then(setLib).catch(() => {});
  }, [load]);

  if (err) return <p className="form-err">{err}</p>;
  if (!list) return <p className="meta">loading…</p>;

  if (planning && lib)
    return (
      <MesoBuilder
        lib={lib}
        onCancel={() => setPlanning(false)}
        onCreated={() => {
          setPlanning(false);
          setTab("workout");
          load();
        }}
      />
    );

  const active = list.active;
  return (
    <div className="grid">
      {active && (
        <div className="tabs train-tabs">
          {(["workout", "plan", "mesocycles"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {active && tab === "workout" && session && (
        <SessionView key={`${session.meso.id}:${session.week}:${session.day}`} lib={lib} session={session} summary={active} onSession={setSession} onDone={load} />
      )}
      {active && tab === "plan" && <MesoPlan id={active.id} lib={lib} onEnded={load} />}
      {(!active || tab === "mesocycles") && <MesoList list={list} onPlan={() => setPlanning(true)} onChange={load} canPlan={!active} />}
    </div>
  );
}

// ---- the workout -------------------------------------------------------------

function SessionView({
  lib,
  session,
  summary,
  onSession,
  onDone,
}: {
  lib: TrainingLibrary | null;
  session: TrainingSession;
  summary: MesoSummary;
  onSession: (s: TrainingSession) => void;
  onDone: () => void;
}) {
  const [calOpen, setCalOpen] = useState(false);
  // An open feedback question; `then` resumes the set log that triggered it.
  const [ask, setAsk] = useState<{ muscle: string; when: "before" | "after"; then?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = session;

  const reload = useCallback(async () => onSession(await api.session(s.meso.id, s.week, s.day)), [onSession, s.meso.id, s.week, s.day]);
  const open = async (week: number, day: number) => {
    setCalOpen(false);
    onSession(await api.session(s.meso.id, week, day));
  };

  // RP asks how a muscle recovered right before its first set (once it has
  // been trained before), and how the work went after its last set.
  const afterLog = (next: TrainingSession, muscle: string) => {
    const fb = next.feedback.find((f) => f.muscle === muscle);
    const sets = next.exercises.filter((e) => e.muscle === muscle).flatMap((e) => e.sets);
    const done = sets.filter((x) => x.done).length;
    if (done === sets.length && fb && fb.pump == null) setAsk({ muscle, when: "after" });
  };
  const beforeLog = (muscle: string, then: () => void): boolean => {
    const fb = s.feedback.find((f) => f.muscle === muscle);
    const started = s.exercises.filter((e) => e.muscle === muscle).some((e) => e.sets.some((x) => x.done));
    if (!started && fb?.askSoreness && fb.soreness == null) {
      setAsk({ muscle, when: "before", then });
      return true;
    }
    return false;
  };

  const p = s.progress;
  const live = !s.completed && p.lastSetAt != null && Date.now() - p.lastSetAt < REST_CLOCK_MAX_S * 1000;
  const now = useNow(live);
  const resting = live && p.lastSetAt != null ? Math.floor((now - p.lastSetAt) / 1000) : null;

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      await api.completeSession(s.meso.id, s.week, s.day);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card train-head">
        <div className="card-head">
          <p className="label">{s.meso.name}</p>
          <button className="daynav-btn" onClick={() => setCalOpen((o) => !o)} aria-label="Mesocycle calendar" aria-expanded={calOpen}>
            <CalendarDays />
          </button>
        </div>
        <p className="train-week">
          Week {s.week} <span>Day {s.day}</span>
        </p>
        <p className="meta">
          {s.label ? `${s.label} · ` : ""}
          {s.deload ? "deload week, light and easy" : `${s.targetRir} RIR`}
          {s.completed ? " · done" : ` · ${p.setsDone}/${p.setsPlanned} sets`}
        </p>
        {p.startedAt != null && (
          <p className="meta train-progress">
            {clock(p.startedAt)}
            {p.elapsedS != null ? ` · ${dur(p.elapsedS)}` : ""}
            {` · ${p.volumeLb.toLocaleString()} lb`}
            {p.avgRestS != null ? ` · avg rest ${dur(p.avgRestS)}` : ""}
          </p>
        )}
        {resting != null && <p className="train-rest">Resting {dur(resting)}</p>}
        {calOpen && <MesoCalendar summary={summary} at={{ week: s.week, day: s.day }} onPick={open} />}
      </section>

      {s.exercises.map((ex, i) => {
        const firstOfMuscle = s.exercises.findIndex((e) => e.muscle === ex.muscle) === i;
        return (
          <ExerciseCard
            key={ex.slotId}
            lib={lib}
            session={s}
            ex={ex}
            showMuscle={firstOfMuscle}
            onBeforeLog={(then) => beforeLog(ex.muscle, then)}
            onChanged={async () => {
              const next = await api.session(s.meso.id, s.week, s.day);
              onSession(next);
              afterLog(next, ex.muscle);
            }}
            onRate={() => setAsk({ muscle: ex.muscle, when: "after" })}
          />
        );
      })}

      {err && <p className="form-err">{err}</p>}
      {!s.completed ? (
        <button className="btn train-finish" onClick={finish} disabled={busy}>
          {busy ? "Saving…" : p.setsDone < p.setsPlanned ? `Finish workout · ${p.setsPlanned - p.setsDone} sets unlogged` : "Finish workout"}
        </button>
      ) : (
        <p className="meta train-done">Completed{s.completedAt ? ` ${new Date(s.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</p>
      )}

      {ask && (
        <FeedbackSheet
          title={label(lib, ask.muscle)}
          when={ask.when}
          scales={s.feedbackScales}
          current={s.feedback.find((f) => f.muscle === ask.muscle)}
          onClose={() => {
            setAsk(null);
            ask.then?.();
          }}
          onSave={async (vals) => {
            await api.setFeedback(s.meso.id, { week: s.week, day: s.day, muscle: ask.muscle, ...vals });
            setAsk(null);
            if (ask.then) ask.then();
            else await reload();
          }}
        />
      )}
    </>
  );
}

function ExerciseCard({
  lib,
  session,
  ex,
  showMuscle,
  onBeforeLog,
  onChanged,
  onRate,
}: {
  lib: TrainingLibrary | null;
  session: TrainingSession;
  ex: TrainingSession["exercises"][number];
  showMuscle: boolean;
  onBeforeLog: (then: () => void) => boolean;
  onChanged: () => Promise<void>;
  onRate: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const fb = session.feedback.find((f) => f.muscle === ex.muscle);
  const last = ex.lastWeek.map((x) => `${x.weightLb ?? 0}×${x.reps ?? 0}`).join(", ");
  const choices = (lib?.exercises ?? []).filter((e) => e.muscle === ex.muscle);

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    await fn();
    await onChanged();
  };

  return (
    <section className="card train-ex">
      <div className="train-ex-top">
        <span className="train-muscle">{label(lib, ex.muscle)}</span>
        {showMuscle && fb && (fb.pump != null || fb.soreness != null) && <span className="train-rated">rated</span>}
        <button className="daynav-btn train-menu-btn" onClick={() => setMenu((m) => !m)} aria-label={`${ex.exerciseName} options`}>
          <MoreVertical />
        </button>
        {menu && (
          <div className="menu train-menu" role="menu">
            <button className="menu-item" onClick={() => act(() => api.addSet(ex.slotId, session.week))}>
              Add a set
            </button>
            {ex.sets.length > 1 && (
              <button className="menu-item" onClick={() => act(() => api.deleteSet(ex.sets[ex.sets.length - 1].id))}>
                Remove last set
              </button>
            )}
            <button
              className="menu-item"
              onClick={() => {
                setMenu(false);
                setSwapping(true);
              }}
            >
              Replace exercise
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setMenu(false);
                onRate();
              }}
            >
              Rate {label(lib, ex.muscle).toLowerCase()}
            </button>
          </div>
        )}
      </div>
      <p className="train-ex-name">{ex.exerciseName}</p>
      <p className="train-ex-equip">{ex.equipment}</p>
      {swapping && (
        <div className="train-swap">
          <Select
            value={ex.exerciseId}
            ariaLabel="Replacement exercise"
            options={choices.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(id) => {
              setSwapping(false);
              if (id !== ex.exerciseId) act(() => api.swapExercise(ex.slotId, id, session.week));
            }}
          />
        </div>
      )}
      {last && <p className="meta train-last">last week {last}</p>}

      <div className="train-sets">
        <div className="train-set train-set-head">
          <span />
          <span>weight</span>
          <span>reps{session.targetRir != null ? ` · ${session.targetRir} rir` : ""}</span>
          <span>log</span>
        </div>
        {ex.sets.map((set, i) => (
          <SetRow key={set.id} n={i + 1} set={set} hint={ex.lastWeek[i] ?? ex.lastWeek.at(-1)} onBeforeLog={onBeforeLog} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function SetRow({
  n,
  set,
  hint,
  onBeforeLog,
  onChanged,
}: {
  n: number;
  set: TrainingSet;
  hint: { weightLb: number | null; reps: number | null } | undefined;
  onBeforeLog: (then: () => void) => boolean;
  onChanged: () => Promise<void>;
}) {
  const [w, setW] = useState(set.weightLb != null ? String(set.weightLb) : "");
  const [r, setR] = useState(set.reps != null ? String(set.reps) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setW(set.weightLb != null ? String(set.weightLb) : "");
    setR(set.reps != null ? String(set.reps) : "");
  }, [set.weightLb, set.reps]);

  const wHint = set.targetWeightLb ?? hint?.weightLb ?? null;
  const rHint = set.targetReps ?? hint?.reps ?? null;

  async function save(done: boolean | undefined) {
    const weight = w.trim() ? Number(w) : wHint;
    const reps = r.trim() ? Number(r) : rHint;
    setBusy(true);
    try {
      if (done === false) await api.updateSet(set.id, { done: false });
      else if (reps != null) await api.updateSet(set.id, { weightLb: weight ?? 0, reps, ...(done ? { done: true } : {}) });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const toggle = () => {
    if (set.done) return save(false);
    if (onBeforeLog(() => save(true))) return;
    return save(true);
  };
  // Editing a logged set saves on blur.
  const blur = () => {
    if (set.done && (Number(w) !== set.weightLb || Number(r) !== set.reps) && r.trim()) save(undefined);
  };

  return (
    <div className={`train-set ${set.done ? "done" : ""}`}>
      <span className="train-set-n">{n}</span>
      <input
        inputMode="decimal"
        aria-label={`Set ${n} weight in pounds`}
        placeholder={wHint != null ? String(wHint) : "lb"}
        value={w}
        onChange={(e) => setW(e.target.value)}
        onBlur={blur}
      />
      <input
        inputMode="numeric"
        aria-label={`Set ${n} reps`}
        placeholder={rHint != null ? String(rHint) : "reps"}
        value={r}
        onChange={(e) => setR(e.target.value)}
        onBlur={blur}
      />
      <button className={`train-log ${set.done ? "on" : ""}`} onClick={toggle} disabled={busy} aria-label={set.done ? `Unlog set ${n}` : `Log set ${n}`} aria-pressed={set.done}>
        {set.done && <Check />}
      </button>
      {set.loggedAt != null && (
        <span className="train-set-time">
          {clock(set.loggedAt)}
          {set.restS != null ? ` · rest ${dur(set.restS)}` : ""}
        </span>
      )}
    </div>
  );
}

function FeedbackSheet({
  title,
  when,
  scales,
  current,
  onClose,
  onSave,
}: {
  title: string;
  when: "before" | "after";
  scales: FeedbackScales;
  current: MuscleFeedback | undefined;
  onClose: () => void;
  onSave: (vals: Partial<Record<"soreness" | "pump" | "jointPain" | "workload", number>>) => Promise<void>;
}) {
  const qs =
    when === "before"
      ? ([["soreness", "How sore did you get AFTER training it LAST TIME?"]] as const)
      : ([
          ["pump", "How much of a pump did you get today?"],
          ["jointPain", "How did your joints feel?"],
          ["workload", "How was the volume of work (number of hard sets)?"],
        ] as const);
  const [vals, setVals] = useState<Partial<Record<(typeof qs)[number][0], number>>>(() =>
    Object.fromEntries(qs.flatMap(([k]) => (current?.[k] != null ? [[k, current[k]]] : []))),
  );
  const [busy, setBusy] = useState(false);
  const complete = qs.every(([k]) => vals[k] != null);

  const pick = async (k: (typeof qs)[number][0], i: number) => {
    const next = { ...vals, [k]: i };
    setVals(next);
    // One-question sheets save on tap, like RP.
    if (qs.length === 1) {
      setBusy(true);
      await onSave(next);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet train-fb" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${title} feedback`}>
        <div className="card-head">
          <p className="label">{title} / {when === "before" ? "before you start" : "how did it go"}</p>
          <button className="daynav-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {qs.map(([k, q]) => (
          <div className="train-fb-q" key={k}>
            <p className="train-fb-title">{q}</p>
            <div className="train-fb-opts">
              {scales[k].map((a, i) => (
                <button key={a} className={`train-fb-opt ${vals[k] === i ? "on" : ""}`} onClick={() => pick(k, i)} disabled={busy}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        ))}
        {qs.length > 1 && (
          <div className="sheet-actions">
            <button className="btn ghost" onClick={onClose}>
              Skip
            </button>
            <button
              className="btn"
              disabled={!complete || busy}
              onClick={async () => {
                setBusy(true);
                await onSave(vals);
              }}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Weeks across, days down, like RP's mesocycle overview.
function MesoCalendar({ summary, at, onPick }: { summary: MesoSummary; at: { week: number; day: number }; onPick: (week: number, day: number) => void }) {
  return (
    <div className="train-cal" style={{ gridTemplateColumns: `repeat(${summary.weeks}, minmax(0, 1fr))` }}>
      {summary.calendar.map((w) => (
        <div className="train-cal-week" key={w.week}>
          <span className="train-cal-head">
            {w.deload ? "DL" : `W${w.week}`}
            <small>{w.deload ? "deload" : `${w.rir} rir`}</small>
          </span>
          {w.days.map((d) => (
            <button
              key={d.day}
              className={`train-cal-day ${d.done ? "done" : ""} ${at.week === w.week && at.day === d.day ? "at" : ""}`}
              onClick={() => onPick(w.week, d.day)}
              title={d.label ?? undefined}
            >
              D{d.day}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- the plan: day layouts + weekly volume vs landmarks ----------------------

function MesoPlan({ id, lib, onEnded }: { id: string; lib: TrainingLibrary | null; onEnded: () => void }) {
  const [m, setM] = useState<MesoDetail | null>(null);
  useEffect(() => {
    api.mesocycle(id).then(setM).catch(() => {});
  }, [id]);
  if (!m) return <p className="meta">loading…</p>;
  const end = async (status: "completed" | "abandoned") => {
    await api.updateMesocycle(m.id, { status });
    onEnded();
  };
  return (
    <>
      <section className="card">
        <div className="card-head">
          <p className="label">Weekly sets / muscle</p>
          <span className="meta">MEV · MRV</span>
        </div>
        <div className="train-vol" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${m.weeks}, 1.6rem) 2.6rem` }}>
          <span />
          {m.calendar.map((w) => (
            <span className="train-vol-h" key={w.week}>
              {w.deload ? "DL" : `W${w.week}`}
            </span>
          ))}
          <span className="train-vol-h">range</span>
          {m.volume.map((v) => (
            <VolumeRow key={v.muscle} v={v} planned={m.weekPlanned} />
          ))}
        </div>
        <p className="meta">weeks plan ahead as you log; sets climb from MEV toward MRV with your feedback</p>
      </section>
      {m.days.map((d) => (
        <section className="card" key={d.id}>
          <p className="label">
            Day {d.day}
            {d.label ? ` / ${d.label}` : ""}
          </p>
          <div className="rows">
            {d.slots.map((s) => (
              <div className="crow" key={s.id}>
                <div className="crow-top">
                  <span className="crow-label">{label(lib, s.muscle)}</span>
                  <span className="train-plan-ex">{s.exerciseName}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="sheet-actions">
        <button className="btn ghost" onClick={() => end("abandoned")}>
          End early
        </button>
        <button className="btn ghost" onClick={() => end("completed")}>
          Mark complete
        </button>
      </div>
    </>
  );
}

// A week still being planned (some days not reached yet) shows its partial
// count dimmed and isn't judged against the landmarks.
function VolumeRow({ v, planned }: { v: MesoDetail["volume"][number]; planned: boolean[] }) {
  return (
    <>
      <span className="train-vol-m">{v.label}</span>
      {v.setsByWeek.map((n, i) => (
        <span
          key={i}
          className={`train-vol-n ${!planned[i] ? "partial" : v.mrv != null && n > v.mrv ? "over" : v.mev != null && n > 0 && n < v.mev ? "under" : ""}`}
        >
          {n || "·"}
        </span>
      ))}
      <span className="train-vol-r">
        {v.mev ?? "?"}–{v.mrv ?? "?"}
      </span>
    </>
  );
}

// ---- mesocycle list ------------------------------------------------------------

function MesoList({
  list,
  onPlan,
  onChange,
  canPlan,
}: {
  list: { mesocycles: MesoSummary[]; active: MesoSummary | null };
  onPlan: () => void;
  onChange: () => void;
  canPlan: boolean;
}) {
  const remove = async (m: MesoSummary) => {
    if (!confirm(`Delete “${m.name}” and its logged sets? Its finished workouts stay in your workout log.`)) return;
    await api.deleteMesocycle(m.id);
    onChange();
  };
  return (
    <>
      {canPlan && (
        <section className="card">
          <p className="label">Mesocycles</p>
          <p className="insight">{list.mesocycles.length ? "No mesocycle running" : "Plan your first mesocycle"}</p>
          <p className="meta">
            a block of weeks on one split: sets per muscle start near MEV and build toward MRV, reps in reserve drop from 3 to 0, then a
            deload. or ask the agent, “plan me a 4 day upper lower meso”.
          </p>
          <button className="btn train-new" onClick={onPlan}>
            <Plus /> New mesocycle
          </button>
        </section>
      )}
      {list.mesocycles.map((m) => (
        <section className="card" key={m.id}>
          <div className="card-head">
            <p className="label">{m.name}</p>
            <span className={`status ${m.status === "active" ? "good" : "info"}`}>{m.status}</span>
          </div>
          <p className="meta">
            {m.weeks} weeks · {m.daysPerWeek} days/week · started {m.startDate}
            {m.endedDate ? ` · ended ${m.endedDate}` : ""}
          </p>
          <div className="crow-bar">
            <span style={{ width: `${(m.sessionsDone / Math.max(1, m.sessionsTotal)) * 100}%` }} />
          </div>
          <div className="meta-row">
            <span className="meta">
              {m.sessionsDone}/{m.sessionsTotal} sessions
            </span>
            {m.status !== "active" && (
              <button className="x sm" onClick={() => remove(m)} aria-label={`Delete ${m.name}`}>
                ✕
              </button>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

// ---- planning a new mesocycle ------------------------------------------------

type DraftDay = { label: string; slots: { muscle: string; exerciseId: string }[] };

function MesoBuilder({ lib, onCancel, onCreated }: { lib: TrainingLibrary; onCancel: () => void; onCreated: () => void }) {
  const firstFor = useCallback((muscle: string, used: string[] = []) => {
    const pool = lib.exercises.filter((e) => e.muscle === muscle);
    return (pool.find((e) => !used.includes(e.id)) ?? pool[0])?.id ?? "";
  }, [lib]);
  const fromTemplate = useCallback(
    (key: string): DraftDay[] => {
      const t = lib.templates.find((x) => x.key === key);
      if (!t) return [{ label: "Day 1", slots: [] }];
      return t.days.map((d) => {
        const used: string[] = [];
        return {
          label: d.label,
          slots: d.muscles.map((m) => {
            const id = firstFor(m, used);
            used.push(id);
            return { muscle: m, exerciseId: id };
          }),
        };
      });
    },
    [lib, firstFor],
  );

  const [template, setTemplate] = useState(lib.templates[1]?.key ?? lib.templates[0]?.key ?? "");
  const [days, setDays] = useState<DraftDay[]>(() => fromTemplate(template));
  const [weeks, setWeeks] = useState("5");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Slots per muscle per week, beside its landmarks (sets land near MEV).
  const perMuscle = useMemo(() => {
    const n = new Map<string, number>();
    for (const d of days) for (const s of d.slots) n.set(s.muscle, (n.get(s.muscle) ?? 0) + 1);
    return [...n.entries()];
  }, [days]);

  const edit = (i: number, fn: (d: DraftDay) => DraftDay) => setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const muscleOpts = lib.muscles.map((m) => ({ value: m.key, label: m.label }));

  async function create() {
    setErr(null);
    if (days.some((d) => !d.slots.length)) return setErr("every day needs at least one muscle group");
    setBusy(true);
    try {
      const plan: MesoPlanDay[] = days.map((d) => ({ label: d.label.trim() || undefined, slots: d.slots.map((s) => ({ muscle: s.muscle, exerciseId: s.exerciseId || undefined })) }));
      await api.createMesocycle(todayLocal(), { name: name.trim() || undefined, weeks: Number(weeks), template: template || undefined, days: plan });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <p className="label">New mesocycle</p>
        <div className="form">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={lib.templates.find((t) => t.key === template)?.name ?? "mesocycle"} />
          </label>
          <div className="field">
            <span>Template</span>
            <Select
              value={template}
              ariaLabel="Template"
              options={[...lib.templates.map((t) => ({ value: t.key, label: t.name })), { value: "", label: "Start from scratch" }]}
              onChange={(v) => {
                setTemplate(v);
                setDays(v ? fromTemplate(v) : [{ label: "Day 1", slots: [] }]);
              }}
            />
          </div>
          <div className="field">
            <span>Length</span>
            <Select
              value={weeks}
              ariaLabel="Weeks"
              options={[3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} weeks (${n - 1} + deload)` }))}
              onChange={setWeeks}
            />
          </div>
        </div>
      </section>

      {days.map((d, i) => (
        <section className="card" key={i}>
          <div className="card-head">
            <input className="train-day-label" value={d.label} onChange={(e) => edit(i, (x) => ({ ...x, label: e.target.value }))} aria-label={`Day ${i + 1} label`} />
            {days.length > 1 && (
              <button className="x sm" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))} aria-label={`Remove day ${i + 1}`}>
                ✕
              </button>
            )}
          </div>
          <div className="train-slots">
            {d.slots.map((s, k) => (
              <div className="train-slot" key={k}>
                <Select
                  value={s.muscle}
                  ariaLabel="Muscle group"
                  options={muscleOpts}
                  onChange={(m) => edit(i, (x) => ({ ...x, slots: x.slots.map((y, j) => (j === k ? { muscle: m, exerciseId: firstFor(m) } : y)) }))}
                />
                <Select
                  value={s.exerciseId}
                  ariaLabel="Exercise"
                  options={lib.exercises.filter((e) => e.muscle === s.muscle).map((e) => ({ value: e.id, label: e.name }))}
                  onChange={(id) => edit(i, (x) => ({ ...x, slots: x.slots.map((y, j) => (j === k ? { ...y, exerciseId: id } : y)) }))}
                />
                <button className="x sm" onClick={() => edit(i, (x) => ({ ...x, slots: x.slots.filter((_, j) => j !== k) }))} aria-label="Remove exercise">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn ghost train-add"
            onClick={() => edit(i, (x) => ({ ...x, slots: [...x.slots, { muscle: "chest", exerciseId: firstFor("chest", x.slots.map((y) => y.exerciseId)) }] }))}
          >
            <Plus /> Add a muscle group
          </button>
        </section>
      ))}
      {days.length < 7 && (
        <button className="btn ghost" onClick={() => setDays((ds) => [...ds, { label: `Day ${ds.length + 1}`, slots: [] }])}>
          <Plus /> Add a day
        </button>
      )}

      <section className="card">
        <p className="label">Slots per week</p>
        <div className="rows">
          {perMuscle.map(([m, n]) => {
            const info = lib.muscles.find((x) => x.key === m);
            return (
              <div className="crow" key={m}>
                <div className="crow-top">
                  <span className="crow-label">{info?.label ?? m}</span>
                  <span className="meta">
                    {n}× · MEV {info?.mev} · MRV {info?.mrv}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {err && <p className="form-err">{err}</p>}
      <div className="sheet-actions">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create mesocycle"}
        </button>
      </div>
    </div>
  );
}
