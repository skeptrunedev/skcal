import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { makeStyles, useTheme, type Palette } from "./theme";
import { Phase, startPhase, endPhase, todayLocal } from "./api";
import { Sheet, Field } from "./Sheet";

// The open goal phase (bulk / cut / maintain), mirroring the web PhaseCard:
// planned vs actual weekly rate, and starting or ending one. Calories default
// to maintenance estimated from the user's own logs plus the rate's surplus or
// deficit.
const KINDS: Phase["kind"][] = ["bulk", "cut", "maintain"];
const DEFAULT_RATE: Record<Phase["kind"], string> = { bulk: "0.25", cut: "-0.5", maintain: "0" };
const STATUS: Record<Phase["progress"]["status"], [keyof Palette, string]> = {
  on_track: ["amberText", "ON TRACK"],
  too_fast: ["attention", "TOO FAST"],
  too_slow: ["attention", "TOO SLOW"],
  not_enough_data: ["info", "TRACKING"],
};
// A rate can be negative and a date has dashes: iOS's decimal pad has neither,
// Android's numeric pad has both.
const DASH_KEYS = Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric";
const signed = (n: number, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

// "today" / "yesterday" / "Mon, Oct 6", as the web dayLabel.
function dayLabel(date: string): string {
  const today = todayLocal();
  if (date === today) return "today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === y.toLocaleDateString("en-CA")) return "yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function PhaseCard({ phase, onChange }: { phase: Phase | null; onChange: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const end = async () => {
    if (!phase) return;
    setBusy(true);
    try {
      await endPhase(phase.id, todayLocal());
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const p = phase?.progress;
  const status = p ? STATUS[p.status] : null;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={[s.cardLabel, s.shrink]}>PHASE{phase ? ` / ${phase.kind.toUpperCase()}` : ""}</Text>
        {status && <Text style={[s.status, { color: c[status[0]] }]}>{status[1]}</Text>}
      </View>
      {!phase || !p ? (
        <Text style={s.empty}>no goal phase set, start a bulk, cut, or maintenance block</Text>
      ) : (
        <>
          <Text style={s.insight}>
            Week {Math.floor(p.weeksElapsed) + 1}
            {p.weeksPlanned ? ` of ${Math.ceil(p.weeksPlanned)}` : ""}
            {p.changeLb != null ? `, ${signed(p.changeLb, 1)} lb since ${dayLabel(phase.startDate)}` : ""}
          </Text>
          <View style={s.row}>
            <Text style={s.rowLabel}>PLANNED</Text>
            <Text style={s.rowVal}>
              {p.plannedLbPerWeek != null ? signed(p.plannedLbPerWeek) : "—"}
              <Text style={s.unit}> lb/wk · {phase.ratePctPerWeek != null ? signed(phase.ratePctPerWeek) : "—"}%</Text>
            </Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>ACTUAL</Text>
            <Text style={s.rowVal}>
              {p.actualLbPerWeek != null ? signed(p.actualLbPerWeek) : "—"}
              <Text style={s.unit}> lb/wk{p.actualPctPerWeek != null ? ` · ${signed(p.actualPctPerWeek)}%` : ""}</Text>
            </Text>
          </View>
          <Text style={s.meta}>
            {phase.dailyKcalTarget != null ? `${phase.dailyKcalTarget} kcal` : "calories unchanged"}
            {phase.proteinTargetG != null ? ` · ${phase.proteinTargetG} g protein` : ""}
            {phase.goalWeightLb != null ? ` · goal ${phase.goalWeightLb} lb` : ""}
            {phase.plannedEndDate ? ` · until ${phase.plannedEndDate}` : ""}
          </Text>
        </>
      )}
      <View style={s.actions}>
        {phase && (
          <Pressable style={[s.actionGhost, busy && s.dim]} onPress={end} disabled={busy} accessibilityRole="button">
            <Text style={s.actionGhostText}>End {phase.kind}</Text>
          </Pressable>
        )}
        <Pressable style={s.actionGhost} onPress={() => setEditing(true)} accessibilityRole="button">
          <Text style={s.actionGhostText}>{phase ? "New phase" : "Start a phase"}</Text>
        </Pressable>
      </View>
      {/* Remounted per open so the fields start fresh, like the web sheet. */}
      {editing && <PhaseSheet current={phase} onClose={() => setEditing(false)} onSaved={onChange} />}
    </View>
  );
}

function PhaseSheet({ current, onClose, onSaved }: { current: Phase | null; onClose: () => void; onSaved: () => void }) {
  const s = useS();
  const [kind, setKind] = useState<Phase["kind"]>(current?.kind === "bulk" ? "cut" : "bulk");
  const [rate, setRate] = useState(DEFAULT_RATE[kind]);
  const [end, setEnd] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState(current?.proteinTargetG != null ? String(current.proteinTargetG) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    // No native date picker in this app: the end date is typed, so check its shape here.
    if (end.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(end.trim())) return setError("Planned end must be YYYY-MM-DD");
    setError(null);
    setSaving(true);
    try {
      const r = await startPhase(todayLocal(), {
        kind,
        ratePctPerWeek: rate.trim() ? Number(rate) : null,
        plannedEndDate: end.trim() || null,
        dailyKcal: kcal.trim() ? Number(kcal) : null,
        proteinG: protein.trim() ? Number(protein) : null,
      });
      onSaved();
      if (r.kcalSource === "unchanged") {
        // Not enough logs to estimate maintenance: say so instead of guessing.
        setNote("Started. Calories stayed as they were, there isn't enough logged intake yet to estimate maintenance. Ask the agent to set them, or enter them here.");
      } else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      title={note ? "Phase started" : `Start a ${kind === "maintain" ? "maintenance phase" : kind}`}
      onClose={onClose}
      onSave={note ? undefined : save}
      saving={saving}
      error={error}
      saveLabel={`Start ${kind}`}
      cancelLabel={note ? "Done" : "Cancel"}
    >
      {note ? (
        <Text style={s.warn}>{note}</Text>
      ) : (
        <>
          <View style={s.kinds} accessibilityRole="radiogroup">
            {KINDS.map((k) => (
              <Pressable
                key={k}
                style={[s.kind, kind === k && s.kindOn]}
                onPress={() => {
                  setKind(k);
                  setRate(DEFAULT_RATE[k]);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === k }}
              >
                <Text style={[s.kindText, kind === k && s.kindTextOn]}>{k}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="RATE, % BODYWEIGHT / WEEK" value={rate} onChangeText={setRate} keyboardType={DASH_KEYS} />
          <Field label="PLANNED END (OPTIONAL)" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" keyboardType={DASH_KEYS} maxLength={10} />
          <Field label="DAILY CALORIES (BLANK = FROM YOUR LOGS)" value={kcal} onChangeText={setKcal} keyboardType="number-pad" placeholder="auto" />
          <Field label="DAILY PROTEIN G" value={protein} onChangeText={setProtein} keyboardType="number-pad" />
        </>
      )}
    </Sheet>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardHead: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, marginBottom: 8 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    shrink: { flexShrink: 1 },
    status: { fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    empty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    insight: { color: c.fg, fontSize: 19, fontWeight: "700", marginBottom: 6 },
    row: {
      flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 12,
      paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
    },
    rowLabel: { color: c.muted, fontSize: 13, fontFamily: "monospace", letterSpacing: 1 },
    rowVal: { color: c.fg, fontSize: 17, fontWeight: "600" },
    unit: { color: c.muted, fontSize: 13, fontWeight: "400" },
    meta: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 0.4, lineHeight: 17, marginTop: 6 },
    // The web card's sheet-actions row of full-width ghost buttons.
    actions: { flexDirection: "row", gap: 10, marginTop: 14 },
    actionGhost: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingVertical: 13 },
    actionGhostText: { color: c.fg, fontSize: 15, fontWeight: "600" },
    dim: { opacity: 0.5 },
    warn: { color: c.attention, fontSize: 14, lineHeight: 20 },
    kinds: { flexDirection: "row", borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 3, gap: 3 },
    kind: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
    kindOn: { backgroundColor: c.amber },
    kindText: { color: c.fg, fontSize: 14 },
    kindTextOn: { color: c.amberInk, fontWeight: "700" },
  }),
);
