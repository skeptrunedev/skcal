import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { makeStyles, useTheme } from "./theme";
import { Workout, deleteWorkout } from "./api";
import { XIcon } from "./icons";

// The day's workouts, mirroring the web WorkoutLog card: each one's summary,
// its description when that adds anything, and a remove button.
export function WorkoutsCard({ workouts, day, onChanged }: { workouts: Workout[] | null; day: string; onChanged: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const remove = (w: Workout) =>
    Alert.alert("Remove this workout?", w.summary, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(w.id);
          try {
            await deleteWorkout(w.id);
            onChanged();
          } catch (e) {
            Alert.alert("Couldn’t remove the workout", e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>WORKOUTS / {day.toUpperCase()}</Text>
      {workouts == null ? (
        <Text style={s.empty}>loading…</Text>
      ) : workouts.length === 0 ? (
        <Text style={s.empty}>{day === "today" ? "no workouts logged yet — tell the coach what you did" : "no workouts logged this day"}</Text>
      ) : (
        workouts.map((w, i) => (
          <View key={w.id} style={[s.row, i > 0 && s.rowBorder]}>
            <View style={s.rowMain}>
              <Text style={s.summary}>{w.summary}</Text>
              {w.description !== w.summary ? <Text style={s.description}>{w.description}</Text> : null}
            </View>
            <Pressable
              style={s.x}
              disabled={busy != null}
              onPress={() => remove(w)}
              accessibilityRole="button"
              accessibilityLabel="Remove workout"
              hitSlop={6}
            >
              <XIcon size={15} color={c.muted} />
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    empty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    rowMain: { flex: 1, minWidth: 0, gap: 3 },
    summary: { color: c.fg, fontSize: 14.5 },
    description: { color: c.muted, fontSize: 13 },
    x: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  }),
);
