import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, RefreshControl, StyleSheet, Alert, Platform, ActivityIndicator,
  type DimensionValue,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "./theme";
import {
  trainingLibrary, mesocycles, mesocycle, createMesocycle, updateMesocycle, deleteMesocycle,
  currentSession, session as getSession, completeSession, setFeedback, updateSet, deleteSet, addSet, swapExercise,
  todayLocal,
  type TrainingLibrary, type MesoSummary, type MesoDetail, type TrainingSession, type TrainingSet,
  type FeedbackScales, type MuscleFeedback, type MesoPlanDay,
} from "./api";
import { Sheet, Field } from "./Sheet";
import { Select, OptionSheet } from "./Select";
import { CalendarDaysIcon, CheckIcon, MoreVerticalIcon, PlusIcon, XIcon } from "./icons";

// RP Hypertrophy-style training, mirroring the web Train view: the active
// mesocycle's workout (week / day header, exercise cards with weight · reps ·
// log rows, soreness before a muscle and pump / joint pain / workload after
// it), the mesocycle's plan (calendar + weekly sets per muscle vs its
// landmarks), and planning a new one. Same /api/training endpoints.

type Tab = "workout" | "plan" | "mesocycles";
type MesoList = { mesocycles: MesoSummary[]; active: MesoSummary | null };

const label = (lib: TrainingLibrary | null, muscle: string) =>
  lib?.muscles.find((m) => m.key === muscle)?.label ?? muscle.replace(/_/g, " ");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Train({
  onAuthError,
  onSubscriptionRequired,
}: {
  onAuthError: (e: Error) => void;
  onSubscriptionRequired?: () => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [lib, setLib] = useState<TrainingLibrary | null>(null);
  const [list, setList] = useState<MesoList | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [tab, setTab] = useState<Tab>("workout");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, cur] = await Promise.all([mesocycles(), currentSession()]);
      setList(l);
      setSession(cur.active ? cur.session : null);
      setError(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.message === "unauthorized") onAuthError(err);
      else if (err.message === "subscription required") {
        if (onSubscriptionRequired) onSubscriptionRequired();
        else setError("This account is not active.");
      } else setError(err.message);
    }
  }, [onAuthError, onSubscriptionRequired]);

  useEffect(() => {
    load();
    trainingLibrary().then(setLib).catch(() => {});
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (error) return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!list) return <View style={s.center}><Text style={s.muted}>loading…</Text></View>;

  const active = list.active;
  let body: ReactNode;
  if (planning && lib) {
    body = (
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
  } else {
    body = (
      <>
        {active && (
          <View style={s.tabs} accessibilityRole="tablist">
            {(["workout", "plan", "mesocycles"] as Tab[]).map((t) => (
              <Pressable
                key={t}
                style={[s.tab, tab === t && s.tabOn]}
                onPress={() => setTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
              >
                <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {active && tab === "workout" && session && (
          <SessionView key={`${session.meso.id}:${session.week}:${session.day}`} lib={lib} session={session} summary={active} onSession={setSession} onDone={load} />
        )}
        {active && tab === "plan" && <MesoPlan id={active.id} lib={lib} onEnded={load} />}
        {(!active || tab === "mesocycles") && <MesoListView list={list} onPlan={() => setPlanning(true)} onChange={load} canPlan={!active} />}
      </>
    );
  }

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.amber} colors={[c.amber]} progressBackgroundColor={c.card} />}
    >
      {/* One column like the web view; capped so a tablet's rows don't stretch. */}
      <View style={s.page}>{body}</View>
    </ScrollView>
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
  const st = useS();
  const { c } = useTheme();
  const [calOpen, setCalOpen] = useState(false);
  // An open feedback question; `then` resumes the set log that triggered it.
  const [ask, setAsk] = useState<{ muscle: string; when: "before" | "after"; then?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = session;

  const reload = useCallback(async () => onSession(await getSession(s.meso.id, s.week, s.day)), [onSession, s.meso.id, s.week, s.day]);
  const open = async (week: number, day: number) => {
    setCalOpen(false);
    try {
      onSession(await getSession(s.meso.id, week, day));
    } catch (e) {
      setErr(errText(e));
    }
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

  const logged = s.exercises.flatMap((e) => e.sets).filter((x) => x.done).length;
  const total = s.exercises.flatMap((e) => e.sets).length;

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await completeSession(s.meso.id, s.week, s.day);
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={st.card}>
        <View style={st.cardHead}>
          <Text style={[st.cardLabel, st.shrink]}>{s.meso.name.toUpperCase()}</Text>
          <Pressable
            style={st.iconBtn}
            onPress={() => setCalOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="Mesocycle calendar"
            accessibilityState={{ expanded: calOpen }}
            hitSlop={6}
          >
            <CalendarDaysIcon size={18} color={calOpen ? c.amberText : c.muted} />
          </Pressable>
        </View>
        <Text style={st.week}>
          WEEK {s.week} <Text style={st.weekDay}>DAY {s.day}</Text>
        </Text>
        <Text style={st.meta}>
          {s.label ? `${s.label} · ` : ""}
          {s.deload ? "deload week, light and easy" : `${s.targetRir} RIR`}
          {s.completed ? " · done" : ` · ${logged}/${total} sets`}
        </Text>
        {calOpen && <MesoCalendar summary={summary} at={{ week: s.week, day: s.day }} onPick={open} />}
      </View>

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
              const next = await getSession(s.meso.id, s.week, s.day);
              onSession(next);
              afterLog(next, ex.muscle);
            }}
            onRate={() => setAsk({ muscle: ex.muscle, when: "after" })}
          />
        );
      })}

      {err ? <Text style={st.formErr}>{err}</Text> : null}
      {!s.completed ? (
        <Pressable style={[st.btn, busy && st.btnDim]} onPress={finish} disabled={busy} accessibilityRole="button">
          {busy ? (
            <ActivityIndicator color={c.amberInk} />
          ) : (
            <Text style={st.btnText}>{logged < total ? `Finish workout · ${total - logged} sets unlogged` : "Finish workout"}</Text>
          )}
        </Pressable>
      ) : (
        <Text style={[st.meta, st.centerText]}>
          Completed{s.completedAt ? ` ${new Date(s.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
        </Text>
      )}

      {ask && (
        <FeedbackSheet
          key={`${ask.muscle}:${ask.when}`}
          title={label(lib, ask.muscle)}
          when={ask.when}
          scales={s.feedbackScales}
          current={s.feedback.find((f) => f.muscle === ask.muscle)}
          onClose={() => {
            setAsk(null);
            ask.then?.();
          }}
          onSave={async (vals) => {
            await setFeedback(s.meso.id, { week: s.week, day: s.day, muscle: ask.muscle, ...vals });
            setAsk(null);
            if (ask.then) ask.then();
            else await reload();
          }}
        />
      )}
    </>
  );
}

type Ex = TrainingSession["exercises"][number];

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
  ex: Ex;
  showMuscle: boolean;
  onBeforeLog: (then: () => void) => boolean;
  onChanged: () => Promise<void>;
  onRate: () => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const [menu, setMenu] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fb = session.feedback.find((f) => f.muscle === ex.muscle);
  const last = ex.lastWeek.map((x) => `${x.weightLb ?? 0}×${x.reps ?? 0}`).join(", ");
  const choices = (lib?.exercises ?? []).filter((e) => e.muscle === ex.muscle);
  const muscleName = label(lib, ex.muscle);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const actions = [
    { value: "add", label: "Add a set" },
    ...(ex.sets.length > 1 ? [{ value: "remove", label: "Remove last set" }] : []),
    { value: "swap", label: "Replace exercise" },
    { value: "rate", label: `Rate ${muscleName.toLowerCase()}` },
  ];
  const onAction = (a: string) => {
    if (a === "add") act(() => addSet(ex.slotId, session.week));
    else if (a === "remove") act(() => deleteSet(ex.sets[ex.sets.length - 1].id));
    else if (a === "swap") setSwapping(true);
    else if (a === "rate") onRate();
  };

  return (
    <View style={s.card}>
      <View style={s.exTop}>
        <Text style={s.muscle}>{muscleName.toUpperCase()}</Text>
        {showMuscle && fb && (fb.pump != null || fb.soreness != null) && <Text style={s.rated}>RATED</Text>}
        <Pressable style={[s.iconBtn, s.exMenuBtn]} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={`${ex.exerciseName} options`} hitSlop={6}>
          <MoreVerticalIcon size={18} color={c.muted} />
        </Pressable>
      </View>
      <Text style={s.exName}>{ex.exerciseName}</Text>
      <Text style={s.exEquip}>{ex.equipment.toUpperCase()}</Text>
      {last ? <Text style={[s.meta, s.exLast]}>last week {last}</Text> : null}

      <View style={s.sets}>
        <View style={s.setRow}>
          <Text style={[s.setHead, s.setN]} />
          <Text style={[s.setHead, s.setCol]}>WEIGHT</Text>
          <Text style={[s.setHead, s.setCol]}>REPS{session.targetRir != null ? ` · ${session.targetRir} RIR` : ""}</Text>
          <Text style={[s.setHead, s.setLogCol]}>LOG</Text>
        </View>
        {ex.sets.map((set, i) => (
          <SetRow
            key={set.id}
            n={i + 1}
            set={set}
            hint={ex.lastWeek[i] ?? ex.lastWeek[ex.lastWeek.length - 1]}
            onBeforeLog={onBeforeLog}
            onChanged={onChanged}
            onError={setErr}
          />
        ))}
      </View>
      {err ? <Text style={s.formErr}>{err}</Text> : null}

      <OptionSheet open={menu} title={ex.exerciseName} options={actions} onClose={() => setMenu(false)} onPick={onAction} />
      <OptionSheet
        open={swapping}
        title="Replacement exercise"
        options={choices.map((x) => ({ value: x.id, label: x.name }))}
        value={ex.exerciseId}
        onClose={() => setSwapping(false)}
        onPick={(id) => {
          if (id !== ex.exerciseId) act(() => swapExercise(ex.slotId, id, session.week));
        }}
      />
    </View>
  );
}

function SetRow({
  n,
  set,
  hint,
  onBeforeLog,
  onChanged,
  onError,
}: {
  n: number;
  set: TrainingSet;
  hint: { weightLb: number | null; reps: number | null } | undefined;
  onBeforeLog: (then: () => void) => boolean;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const [w, setW] = useState(set.weightLb != null ? String(set.weightLb) : "");
  const [r, setR] = useState(set.reps != null ? String(set.reps) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setW(set.weightLb != null ? String(set.weightLb) : "");
    setR(set.reps != null ? String(set.reps) : "");
  }, [set.weightLb, set.reps]);

  const wHint = set.targetWeightLb ?? hint?.weightLb ?? null;
  const rHint = set.targetReps ?? hint?.reps ?? null;

  const save = async (done: boolean | undefined) => {
    const weight = w.trim() ? Number(w) : wHint;
    const reps = r.trim() ? Number(r) : rHint;
    setBusy(true);
    onError(null);
    try {
      if (done === false) await updateSet(set.id, { done: false });
      else if (reps != null) await updateSet(set.id, { weightLb: weight ?? 0, reps, ...(done ? { done: true } : {}) });
      await onChanged();
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

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
    <View style={s.setRow}>
      <Text style={[s.setNum, s.setN]}>{n}</Text>
      <TextInput
        style={[s.setInput, s.setCol, set.done && s.setInputDone, Platform.OS === "web" && WEB_NO_RING]}
        keyboardType="decimal-pad"
        accessibilityLabel={`Set ${n} weight in pounds`}
        placeholder={wHint != null ? String(wHint) : "lb"}
        placeholderTextColor={c.dim}
        value={w}
        onChangeText={setW}
        onBlur={blur}
        returnKeyType="done"
      />
      <TextInput
        style={[s.setInput, s.setCol, set.done && s.setInputDone, Platform.OS === "web" && WEB_NO_RING]}
        keyboardType="number-pad"
        accessibilityLabel={`Set ${n} reps`}
        placeholder={rHint != null ? String(rHint) : "reps"}
        placeholderTextColor={c.dim}
        value={r}
        onChangeText={setR}
        onBlur={blur}
        returnKeyType="done"
      />
      <Pressable
        style={[s.log, s.setLogCol, set.done && s.logOn, busy && s.btnDim]}
        onPress={toggle}
        disabled={busy}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.done, busy }}
        accessibilityLabel={set.done ? `Unlog set ${n}` : `Log set ${n}`}
      >
        {set.done && <CheckIcon size={19} color={c.amberInk} />}
      </Pressable>
    </View>
  );
}

type FbKey = "soreness" | "pump" | "jointPain" | "workload";

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
  onSave: (vals: Partial<Record<FbKey, number>>) => Promise<void>;
}) {
  const s = useS();
  const qs: (readonly [FbKey, string])[] =
    when === "before"
      ? [["soreness", "How sore did you get after training it last time?"]]
      : [
          ["pump", "How much of a pump did you get?"],
          ["jointPain", "Any joint pain?"],
          ["workload", "How was the workload?"],
        ];
  const [vals, setVals] = useState<Partial<Record<FbKey, number>>>(() =>
    Object.fromEntries(qs.flatMap(([k]) => (current?.[k] != null ? [[k, current[k]]] : []))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = qs.every(([k]) => vals[k] != null);

  const submit = async (next: Partial<Record<FbKey, number>>) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  const pick = (k: FbKey, i: number) => {
    const next = { ...vals, [k]: i };
    setVals(next);
    // One-question sheets save on tap, like RP.
    if (qs.length === 1) submit(next);
  };

  return (
    <Sheet
      open
      title={`${title} / ${when === "before" ? "before you start" : "how did it go"}`}
      onClose={onClose}
      onSave={qs.length > 1 ? () => submit(vals) : undefined}
      saveDisabled={!complete}
      saving={busy}
      error={error}
      cancelLabel="Skip"
    >
      {qs.map(([k, q]) => (
        <View key={k} style={s.fbQ}>
          <Text style={s.fbTitle}>{q}</Text>
          <View style={s.fbOpts}>
            {scales[k].map((a, i) => (
              <Pressable
                key={a}
                style={[s.fbOpt, vals[k] === i && s.fbOptOn]}
                onPress={() => pick(k, i)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ selected: vals[k] === i }}
              >
                <Text style={[s.fbOptText, vals[k] === i && s.fbOptTextOn]}>{a}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Sheet>
  );
}

// Weeks across, days down, like RP's mesocycle overview.
function MesoCalendar({ summary, at, onPick }: { summary: MesoSummary; at: { week: number; day: number }; onPick: (week: number, day: number) => void }) {
  const s = useS();
  return (
    <View style={s.cal}>
      {summary.calendar.map((w) => (
        <View key={w.week} style={s.calWeek}>
          <Text style={s.calHead}>{w.deload ? "DL" : `W${w.week}`}</Text>
          <Text style={s.calSub}>{w.deload ? "deload" : `${w.rir} rir`}</Text>
          {w.days.map((d) => {
            const here = at.week === w.week && at.day === d.day;
            return (
              <Pressable
                key={d.day}
                style={[s.calDay, d.done && s.calDayDone, here && s.calDayAt]}
                onPress={() => onPick(w.week, d.day)}
                accessibilityRole="button"
                accessibilityLabel={`Week ${w.week} day ${d.day}${d.label ? `, ${d.label}` : ""}${d.done ? ", done" : ""}`}
              >
                <Text style={[s.calDayText, d.done && s.calDayTextDone, here && s.calDayTextAt]}>D{d.day}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---- the plan: day layouts + weekly volume vs landmarks ----------------------

function MesoPlan({ id, lib, onEnded }: { id: string; lib: TrainingLibrary | null; onEnded: () => void }) {
  const s = useS();
  const [m, setM] = useState<MesoDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    mesocycle(id).then(setM).catch(() => {});
  }, [id]);
  if (!m) return <Text style={s.meta}>loading…</Text>;
  const end = async (status: "completed" | "abandoned") => {
    setBusy(true);
    setErr(null);
    try {
      await updateMesocycle(m.id, { status });
      onEnded();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={[s.cardLabel, s.shrink]}>WEEKLY SETS / MUSCLE</Text>
          <Text style={s.meta}>MEV · MRV</Text>
        </View>
        {/* Scrolls sideways when an 8-week meso doesn't fit a narrow phone. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.volScroll}>
          <View style={s.vol}>
            <View style={s.volRow}>
              <Text style={s.volM} />
              {m.calendar.map((w) => (
                <Text key={w.week} style={[s.volH, s.volCell]}>
                  {w.deload ? "DL" : `W${w.week}`}
                </Text>
              ))}
              <Text style={[s.volH, s.volRange]}>RANGE</Text>
            </View>
            {m.volume.map((v) => (
              <View key={v.muscle} style={s.volRow}>
                <Text style={s.volM} numberOfLines={1}>
                  {v.label.toUpperCase()}
                </Text>
                {v.setsByWeek.map((n, i) => (
                  <Text
                    key={i}
                    style={[s.volN, s.volCell, v.mrv != null && n > v.mrv ? s.volOver : v.mev != null && n > 0 && n < v.mev ? s.volUnder : null]}
                  >
                    {n || "·"}
                  </Text>
                ))}
                <Text style={s.volR}>
                  {v.mev ?? "?"}–{v.mrv ?? "?"}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Text style={s.meta}>weeks plan ahead as you log; sets climb from MEV toward MRV with your feedback</Text>
      </View>
      {m.days.map((d) => (
        <View key={d.id} style={s.card}>
          <Text style={s.cardLabel}>
            DAY {d.day}
            {d.label ? ` / ${d.label.toUpperCase()}` : ""}
          </Text>
          {d.slots.map((x) => (
            <View key={x.id} style={s.row}>
              <Text style={[s.rowLabel, s.shrink]}>{label(lib, x.muscle).toUpperCase()}</Text>
              <Text style={s.planEx}>{x.exerciseName}</Text>
            </View>
          ))}
        </View>
      ))}
      {err ? <Text style={s.formErr}>{err}</Text> : null}
      <View style={s.actions}>
        <Pressable style={[s.ghost, busy && s.btnDim]} onPress={() => end("abandoned")} disabled={busy} accessibilityRole="button">
          <Text style={s.ghostText}>End early</Text>
        </Pressable>
        <Pressable style={[s.ghost, busy && s.btnDim]} onPress={() => end("completed")} disabled={busy} accessibilityRole="button">
          <Text style={s.ghostText}>Mark complete</Text>
        </Pressable>
      </View>
    </>
  );
}

// ---- mesocycle list ------------------------------------------------------------

function MesoListView({ list, onPlan, onChange, canPlan }: { list: MesoList; onPlan: () => void; onChange: () => void; canPlan: boolean }) {
  const s = useS();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const remove = (m: MesoSummary) =>
    Alert.alert(`Delete “${m.name}”?`, "Its logged sets go with it. Its finished workouts stay in your workout log.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(m.id);
          try {
            await deleteMesocycle(m.id);
            onChange();
          } catch (e) {
            Alert.alert("Couldn’t delete the mesocycle", errText(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <>
      {canPlan && (
        <View style={s.card}>
          <Text style={s.cardLabel}>MESOCYCLES</Text>
          <Text style={s.insight}>{list.mesocycles.length ? "No mesocycle running" : "Plan your first mesocycle"}</Text>
          <Text style={s.meta}>
            a block of weeks on one split: sets per muscle start near MEV and build toward MRV, reps in reserve drop from 3 to 0, then a
            deload. or ask the agent, “plan me a 4 day upper lower meso”.
          </Text>
          <Pressable style={[s.btn, s.btnRow, s.spaced]} onPress={onPlan} accessibilityRole="button">
            <PlusIcon size={16} color={c.amberInk} />
            <Text style={s.btnText}>New mesocycle</Text>
          </Pressable>
        </View>
      )}
      {list.mesocycles.map((m) => (
        <View key={m.id} style={s.card}>
          <View style={s.cardHead}>
            <Text style={[s.cardLabel, s.shrink]}>{m.name.toUpperCase()}</Text>
            <Text style={[s.status, { color: m.status === "active" ? c.amberText : c.info }]}>{m.status.toUpperCase()}</Text>
          </View>
          <Text style={s.meta}>
            {m.weeks} weeks · {m.daysPerWeek} days/week · started {m.startDate}
            {m.endedDate ? ` · ended ${m.endedDate}` : ""}
          </Text>
          <View style={[s.bar, s.spaced]}>
            <View style={[s.barFill, { width: `${(m.sessionsDone / Math.max(1, m.sessionsTotal)) * 100}%` as DimensionValue }]} />
          </View>
          <View style={s.metaRow}>
            <Text style={s.meta}>
              {m.sessionsDone}/{m.sessionsTotal} sessions
            </Text>
            {m.status !== "active" && (
              <Pressable
                style={s.x}
                disabled={busy != null}
                onPress={() => remove(m)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${m.name}`}
                hitSlop={6}
              >
                <XIcon size={15} color={c.muted} />
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </>
  );
}

// ---- planning a new mesocycle ------------------------------------------------

type DraftDay = { label: string; slots: { muscle: string; exerciseId: string }[] };
const WEEK_OPTS = [3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} weeks (${n - 1} + deload)` }));

function MesoBuilder({ lib, onCancel, onCreated }: { lib: TrainingLibrary; onCancel: () => void; onCreated: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const firstFor = useCallback(
    (muscle: string, used: string[] = []) => {
      const pool = lib.exercises.filter((e) => e.muscle === muscle);
      return (pool.find((e) => !used.includes(e.id)) ?? pool[0])?.id ?? "";
    },
    [lib],
  );
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
    for (const d of days) for (const x of d.slots) n.set(x.muscle, (n.get(x.muscle) ?? 0) + 1);
    return [...n.entries()];
  }, [days]);

  const edit = (i: number, fn: (d: DraftDay) => DraftDay) => setDays((ds) => ds.map((d, j) => (j === i ? fn(d) : d)));
  const muscleOpts = lib.muscles.map((m) => ({ value: m.key, label: m.label }));

  const create = async () => {
    setErr(null);
    if (days.some((d) => !d.slots.length)) return setErr("every day needs at least one muscle group");
    setBusy(true);
    try {
      const plan: MesoPlanDay[] = days.map((d) => ({
        label: d.label.trim() || undefined,
        slots: d.slots.map((x) => ({ muscle: x.muscle, exerciseId: x.exerciseId || undefined })),
      }));
      await createMesocycle(todayLocal(), { name: name.trim() || undefined, weeks: Number(weeks), template: template || undefined, days: plan });
      onCreated();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={[s.card, s.form]}>
        <Text style={s.cardLabel}>NEW MESOCYCLE</Text>
        <Field label="NAME" value={name} onChangeText={setName} placeholder={lib.templates.find((t) => t.key === template)?.name ?? "mesocycle"} />
        <View style={s.field}>
          <Text style={s.fieldLabel}>TEMPLATE</Text>
          <Select
            value={template}
            label="Template"
            options={[...lib.templates.map((t) => ({ value: t.key, label: t.name })), { value: "", label: "Start from scratch" }]}
            onChange={(v) => {
              setTemplate(v);
              setDays(v ? fromTemplate(v) : [{ label: "Day 1", slots: [] }]);
            }}
          />
        </View>
        <View style={s.field}>
          <Text style={s.fieldLabel}>LENGTH</Text>
          <Select value={weeks} label="Weeks" options={WEEK_OPTS} onChange={setWeeks} />
        </View>
      </View>

      {days.map((d, i) => (
        <View key={i} style={s.card}>
          <View style={s.dayHead}>
            <TextInput
              style={[s.dayLabel, Platform.OS === "web" && WEB_NO_RING]}
              value={d.label}
              onChangeText={(t) => edit(i, (x) => ({ ...x, label: t }))}
              accessibilityLabel={`Day ${i + 1} label`}
              placeholderTextColor={c.dim}
            />
            {days.length > 1 && (
              <Pressable style={s.x} onPress={() => setDays((ds) => ds.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove day ${i + 1}`} hitSlop={6}>
                <XIcon size={15} color={c.muted} />
              </Pressable>
            )}
          </View>
          <View style={s.slots}>
            {d.slots.map((x, k) => (
              <View key={k} style={s.slot}>
                <View style={s.slotMuscle}>
                  <Select
                    value={x.muscle}
                    label="Muscle group"
                    options={muscleOpts}
                    onChange={(m) => edit(i, (y) => ({ ...y, slots: y.slots.map((z, j) => (j === k ? { muscle: m, exerciseId: firstFor(m) } : z)) }))}
                  />
                </View>
                <View style={s.slotEx}>
                  <Select
                    value={x.exerciseId}
                    label="Exercise"
                    options={lib.exercises.filter((e) => e.muscle === x.muscle).map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(id) => edit(i, (y) => ({ ...y, slots: y.slots.map((z, j) => (j === k ? { ...z, exerciseId: id } : z)) }))}
                  />
                </View>
                <Pressable style={s.x} onPress={() => edit(i, (y) => ({ ...y, slots: y.slots.filter((_, j) => j !== k) }))} accessibilityRole="button" accessibilityLabel="Remove exercise" hitSlop={6}>
                  <XIcon size={15} color={c.muted} />
                </Pressable>
              </View>
            ))}
          </View>
          <Pressable
            style={[s.ghostOutline, s.spaced]}
            onPress={() => edit(i, (x) => ({ ...x, slots: [...x.slots, { muscle: "chest", exerciseId: firstFor("chest", x.slots.map((y) => y.exerciseId)) }] }))}
            accessibilityRole="button"
          >
            <PlusIcon size={15} color={c.amberText} />
            <Text style={s.ghostOutlineText}>Add a muscle group</Text>
          </Pressable>
        </View>
      ))}
      {days.length < 7 && (
        <Pressable style={s.ghostOutline} onPress={() => setDays((ds) => [...ds, { label: `Day ${ds.length + 1}`, slots: [] }])} accessibilityRole="button">
          <PlusIcon size={15} color={c.amberText} />
          <Text style={s.ghostOutlineText}>Add a day</Text>
        </Pressable>
      )}

      <View style={s.card}>
        <Text style={s.cardLabel}>SLOTS PER WEEK</Text>
        {perMuscle.map(([m, n]) => {
          const info = lib.muscles.find((x) => x.key === m);
          return (
            <View key={m} style={s.row}>
              <Text style={[s.rowLabel, s.shrink]}>{(info?.label ?? m).toUpperCase()}</Text>
              <Text style={s.meta}>
                {n}× · MEV {info?.mev} · MRV {info?.mrv}
              </Text>
            </View>
          );
        })}
      </View>

      {err ? <Text style={s.formErr}>{err}</Text> : null}
      <View style={s.actions}>
        <Pressable style={s.ghost} onPress={onCancel} disabled={busy} accessibilityRole="button">
          <Text style={s.ghostText}>Cancel</Text>
        </Pressable>
        <Pressable style={[s.btn, busy && s.btnDim]} onPress={create} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={c.amberInk} /> : <Text style={s.btnText}>Create mesocycle</Text>}
        </Pressable>
      </View>
    </>
  );
}

// RNW draws a UA focus ring the border already replaces.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

const VOL_CELL = 30;

const useS = makeStyles((c) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16 },
    page: { width: "100%", maxWidth: 720, alignSelf: "center", gap: 14 },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 },
    err: { color: c.error, textAlign: "center" },
    formErr: { color: c.error, fontSize: 14, marginTop: 8 },
    muted: { color: c.muted },
    shrink: { flexShrink: 1 },
    centerText: { textAlign: "center" },
    spaced: { marginTop: 12 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardHead: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", columnGap: 12, marginBottom: 4 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    status: { fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    insight: { color: c.fg, fontSize: 21, fontWeight: "700", marginBottom: 4 },
    meta: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 0.4, lineHeight: 17 },
    metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
    iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8 },
    x: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8 },

    tabs: { flexDirection: "row", borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 3, gap: 3, backgroundColor: c.card },
    tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
    tabOn: { backgroundColor: c.amber },
    tabText: { color: c.fg, fontSize: 14 },
    tabTextOn: { color: c.amberInk, fontWeight: "700" },

    week: { color: c.fg, fontSize: 26, fontWeight: "700", letterSpacing: -0.4, marginBottom: 4 },
    weekDay: { color: c.muted, fontWeight: "500" },

    exTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    muscle: {
      color: c.amberText, fontSize: 10, fontFamily: "monospace", letterSpacing: 1.2,
      borderWidth: 1, borderColor: c.amberText, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7, overflow: "hidden",
    },
    rated: { color: c.dim, fontSize: 10, fontFamily: "monospace", letterSpacing: 1 },
    exMenuBtn: { marginLeft: "auto" },
    exName: { color: c.fg, fontSize: 17, fontWeight: "600", marginTop: 8, marginBottom: 2 },
    exEquip: { color: c.muted, fontSize: 10, fontFamily: "monospace", letterSpacing: 1.2 },
    exLast: { marginTop: 5 },

    sets: { marginTop: 12, gap: 7 },
    setRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    setN: { width: 20, textAlign: "center" },
    setCol: { flex: 1, minWidth: 0 },
    setLogCol: { width: 44 },
    setHead: { color: c.dim, fontSize: 9.5, fontFamily: "monospace", letterSpacing: 1.2, textAlign: "center" },
    setNum: { color: c.dim, fontSize: 12, fontFamily: "monospace" },
    setInput: {
      borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.field, color: c.fg,
      paddingHorizontal: 8, paddingVertical: 10, fontSize: 16, textAlign: "center", fontVariant: ["tabular-nums"],
    },
    setInputDone: { borderColor: "transparent", backgroundColor: c.raised },
    log: { height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: c.dim, alignItems: "center", justifyContent: "center" },
    logOn: { backgroundColor: c.amber, borderColor: c.amber },

    btn: { minWidth: 96, backgroundColor: c.amber, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
    btnRow: { flexDirection: "row", gap: 6 },
    btnDim: { opacity: 0.6 },
    btnText: { color: c.amberInk, fontWeight: "700", fontSize: 15 },
    ghost: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
    ghostText: { color: c.muted, fontSize: 15 },
    ghostOutline: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingVertical: 11,
    },
    ghostOutlineText: { color: c.amberText, fontSize: 14.5, fontWeight: "600" },
    actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 },

    fbQ: { gap: 8 },
    fbTitle: { color: c.fg, fontSize: 15, fontWeight: "600" },
    fbOpts: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    fbOpt: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.field, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
    fbOptOn: { borderColor: c.amberText },
    fbOptText: { color: c.fg, fontSize: 14, textAlign: "center" },
    fbOptTextOn: { color: c.amberText, fontWeight: "600" },

    cal: { flexDirection: "row", gap: 5, marginTop: 12 },
    calWeek: { flex: 1, minWidth: 0, gap: 5 },
    calHead: { color: c.fg, fontSize: 11, fontFamily: "monospace", textAlign: "center" },
    calSub: { color: c.dim, fontSize: 9, fontFamily: "monospace", textAlign: "center", marginTop: -4 },
    calDay: { borderWidth: 1, borderColor: c.line, backgroundColor: c.field, borderRadius: 7, paddingVertical: 8, alignItems: "center" },
    calDayDone: { backgroundColor: c.raised, borderColor: c.dim },
    calDayAt: { borderColor: c.amberText },
    calDayText: { color: c.muted, fontSize: 11, fontFamily: "monospace" },
    calDayTextDone: { color: c.fg },
    calDayTextAt: { color: c.amberText },

    volScroll: { flexGrow: 1 },
    vol: { flex: 1, gap: 8, marginTop: 4, marginBottom: 10 },
    volRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    volM: { flex: 1, minWidth: 84, color: c.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 0.6 },
    volH: { color: c.dim, fontSize: 9.5, fontFamily: "monospace", textAlign: "center" },
    volCell: { width: VOL_CELL },
    volRange: { width: 50, textAlign: "right" },
    volN: { color: c.fg, fontSize: 15, textAlign: "center", fontVariant: ["tabular-nums"] },
    volOver: { color: c.attention },
    volUnder: { color: c.info },
    volR: { width: 50, color: c.dim, fontSize: 10.5, fontFamily: "monospace", textAlign: "right" },

    row: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12,
      paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
    },
    rowLabel: { color: c.muted, fontSize: 12.5, fontFamily: "monospace", letterSpacing: 1 },
    planEx: { color: c.fg, fontSize: 14.5, textAlign: "right", flexShrink: 1 },

    bar: { height: 8, borderRadius: 999, backgroundColor: c.line, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 999, backgroundColor: c.amber },

    form: { gap: 12 },
    field: { gap: 6 },
    fieldLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    dayHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    dayLabel: {
      flex: 1, minWidth: 0, color: c.fg, fontSize: 13, fontFamily: "monospace", letterSpacing: 1.2,
      borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6,
    },
    slots: { gap: 8 },
    slot: { flexDirection: "row", alignItems: "center", gap: 6 },
    slotMuscle: { flex: 0.8, minWidth: 0 },
    slotEx: { flex: 1.2, minWidth: 0 },
  }),
);
