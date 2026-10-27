import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from "react-native";
import { makeStyles, useTheme } from "./theme";
import { setWeightNote, WeightReading, kgToLb } from "./api";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const PAGE = 7;
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Today's weigh-ins card, mirroring the web WeightHistory:
// the newest PAGE readings with newer/older paging, each with a note editor.
export function WeighInsCard({ weights, onSaved }: { weights: WeightReading[]; onSaved: () => void }) {
  const s = useS();
  const { c } = useTheme();
  // 0 = the newest PAGE weigh-ins; higher pages walk back in time.
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(weights.length / PAGE));
  const at = Math.min(page, pages - 1);
  const visible = weights.slice(at * PAGE, (at + 1) * PAGE);

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>WEIGH-INS · TAP TO NOTE</Text>
      {weights.length === 0 ? (
        <Text style={s.empty}>no weigh-ins yet</Text>
      ) : (
        visible.map((w) => <WeighIn key={w.id} reading={w} onSaved={onSaved} />)
      )}
      {pages > 1 && (
        <View style={s.pager}>
          <Pressable
            style={[s.pageBtn, at === 0 && s.pageBtnOff]}
            onPress={() => setPage(at - 1)}
            disabled={at === 0}
            accessibilityRole="button"
            accessibilityLabel="Newer weigh-ins"
          >
            <ChevronLeftIcon size={17} color={c.muted} />
          </Pressable>
          <Text style={s.pagerLabel}>
            {at * PAGE + 1}–{at * PAGE + visible.length} of {weights.length}
          </Text>
          <Pressable
            style={[s.pageBtn, at === pages - 1 && s.pageBtnOff]}
            onPress={() => setPage(at + 1)}
            disabled={at === pages - 1}
            accessibilityRole="button"
            accessibilityLabel="Older weigh-ins"
          >
            <ChevronRightIcon size={17} color={c.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// One weigh-in row with an inline note editor, as in the web WeightHistory:
// the note saves on submit or when the field loses focus, only if it changed.
function WeighIn({ reading, onSaved }: { reading: WeightReading; onSaved: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const close = async () => {
    if (!editing) return;
    const next = draft.trim();
    if (next === (reading.note ?? "")) return setEditing(false);
    setBusy(true);
    try {
      await setWeightNote(reading.id, next || null);
      setEditing(false);
      onSaved();
    } catch {
      // keep the editor open so the text isn't lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.row}>
      <View style={s.rowMain}>
        <Text style={s.rowLabel}>
          {fmtDate(reading.ts).toUpperCase()}
          {reading.source !== "manual" ? ` · ${reading.source.toUpperCase()}` : ""}
        </Text>
        {editing ? (
          <TextInput
            autoFocus
            style={[s.noteInput, Platform.OS === "web" && WEB_NO_RING]}
            value={draft}
            editable={!busy}
            onChangeText={setDraft}
            placeholder="add a note…"
            placeholderTextColor={c.dim}
            maxLength={500}
            returnKeyType="done"
            onSubmitEditing={close}
            onBlur={close}
          />
        ) : (
          <Pressable
            onPress={() => {
              setDraft(reading.note ?? "");
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={reading.note ? "Edit note" : "Add note"}
            hitSlop={6}
          >
            <Text style={reading.note ? s.note : s.addNote}>{reading.note ? `“${reading.note}”` : "+ add note"}</Text>
          </Pressable>
        )}
      </View>
      <Text style={s.rowVal}>
        {kgToLb(reading.weightKg).toFixed(1)}
        <Text style={s.unit}> lb</Text>
      </Text>
    </View>
  );
}

const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

const useS = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    empty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    row: {
      flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 3 },
    rowLabel: { color: c.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 1, marginTop: 4 },
    rowVal: { color: c.fg, fontSize: 17, fontWeight: "600" },
    unit: { color: c.muted, fontSize: 13, fontWeight: "400" },
    note: { color: c.muted, fontSize: 12, fontFamily: "monospace", lineHeight: 17 },
    addNote: { color: c.dim, fontSize: 12, fontFamily: "monospace" },
    noteInput: {
      borderWidth: 1, borderColor: c.amberText, borderRadius: 8, backgroundColor: c.field, color: c.fg,
      paddingHorizontal: 10, paddingVertical: 6, fontSize: 14,
    },
    pageBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8 },
    pageBtnOff: { opacity: 0.3 },
    pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },
    pagerLabel: { color: c.fg, fontSize: 12, fontFamily: "monospace", minWidth: 72, textAlign: "center" },
  }),
);
