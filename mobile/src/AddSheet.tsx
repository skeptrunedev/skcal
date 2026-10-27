import { useState } from "react";
import { View, Text, TextInput, Pressable, Image, StyleSheet, Platform } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import { makeStyles, useTheme } from "./theme";
import { logWeight, addMeasurement, analyzeMeal, describeMeal, lbToKg, inToCm, todayLocal, type MealAnalysis } from "./api";
import { Sheet, Field } from "./Sheet";
import { Select } from "./Select";
import { MEASUREMENT_SITES, siteLabel } from "./sites";
import { pickFromCamera, pickFromLibrary, toUpload } from "./image";

export type AddTab = "weight" | "measure" | "nutrition";
const TABS: AddTab[] = ["weight", "measure", "nutrition"];
const SITE_OPTIONS = MEASUREMENT_SITES.map((m) => ({ value: m, label: siteLabel(m) }));

// The web AddSheet: one "+" sheet with weight / measure / nutrition tabs. The
// first two are small forms with Save; nutrition is the AI meal analyzer,
// which logs on its own button, so the sheet only offers Done there.
export function AddSheet({
  open,
  onClose,
  onChange,
  defaultTab = "weight",
}: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
  defaultTab?: AddTab;
}) {
  const s = useS();
  const [tab, setTab] = useState<AddTab>(defaultTab);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // weight
  const [lb, setLb] = useState("");
  const [bf, setBf] = useState("");
  const [note, setNote] = useState("");
  // measure
  const [site, setSite] = useState<string>("shoulders");
  const [inches, setInches] = useState("");

  // Same bounds as the web AddSheet.
  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (tab === "weight") {
        const v = parseFloat(lb);
        if (!isFinite(v) || v < 30 || v > 700) throw new Error("Enter a weight between 30 and 700 lb");
        const bfv = bf.trim() ? parseFloat(bf) : null;
        if (bfv != null && (!isFinite(bfv) || bfv < 1 || bfv > 80)) throw new Error("Body fat % must be 1–80");
        await logWeight(lbToKg(v), note.trim() || null, bfv);
      } else if (tab === "measure") {
        const v = parseFloat(inches);
        if (!isFinite(v) || v < 1 || v > 120) throw new Error("Enter a measurement between 1 and 120 in");
        await addMeasurement(site, inToCm(v));
      }
      onChange();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onSave={tab === "nutrition" ? undefined : save}
      saving={busy}
      error={tab === "nutrition" ? null : err}
      cancelLabel={tab === "nutrition" ? "Done" : "Cancel"}
    >
      <View style={s.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t}
            style={[s.tab, tab === t && s.tabOn]}
            onPress={() => {
              setTab(t);
              setErr(null);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "weight" && (
        <>
          <Field label="WEIGHT (LB)" value={lb} onChangeText={setLb} keyboardType="decimal-pad" placeholder="160.0" />
          <Field label="BODY FAT % (OPTIONAL, NOISY)" value={bf} onChangeText={setBf} keyboardType="decimal-pad" placeholder="20" />
          <Field label="NOTE (OPTIONAL)" value={note} onChangeText={setNote} placeholder="post-workout, dehydrated, …" maxLength={500} />
        </>
      )}

      {tab === "measure" && (
        <>
          <View style={s.field}>
            <Text style={s.fieldLabel}>SITE</Text>
            <Select value={site} options={SITE_OPTIONS} onChange={setSite} label="Measurement site" />
          </View>
          <Field label="MEASUREMENT (IN)" value={inches} onChangeText={setInches} keyboardType="decimal-pad" placeholder="15.0" />
        </>
      )}

      {tab === "nutrition" && <MealAnalyzer onLogged={onChange} />}
    </Sheet>
  );
}

// The web MealAnalyzer: up to 5 photos of one meal and/or a description,
// estimated by AI and logged to today.
function MealAnalyzer({ onLogged }: { onLogged: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [photos, setPhotos] = useState<ImagePickerAsset[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MealAnalysis | null>(null);

  const addPhotos = (incoming: ImagePickerAsset[]) => {
    if (!incoming.length) return;
    setPhotos((prev) => [...prev, ...incoming].slice(0, 5));
    setResult(null);
    setErr(null);
  };

  const reset = () => {
    setPhotos([]);
    setDescription("");
    setResult(null);
    setErr(null);
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const text = description.trim();
      setResult(
        photos.length ? await analyzeMeal(todayLocal(), photos.map(toUpload), text) : await describeMeal(todayLocal(), text),
      );
      onLogged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <>
        <Text style={s.insight}>
          Logged · {result.totalKcal} kcal / {result.totalProteinG}g protein
        </Text>
        <View>
          {result.items.map((it, i) => (
            <View key={i} style={s.crow}>
              <Text style={s.crowLabel}>{it.name}</Text>
              <Text style={s.crowVal}>
                {it.kcal}
                <Text style={s.unit}> kcal · {Math.round(it.proteinG)}g</Text>
              </Text>
            </View>
          ))}
        </View>
        {result.note ? <Text style={s.meta}>{result.note}</Text> : null}
        <Pressable style={s.ghostBtn} onPress={reset} accessibilityRole="button">
          <Text style={s.ghostBtnText}>Log another meal</Text>
        </Pressable>
      </>
    );
  }

  const hasPhotos = photos.length > 0;
  const hasText = description.trim().length > 0;
  const disabled = busy || (!hasPhotos && !hasText);

  return (
    <>
      <View style={s.picks}>
        <Pressable style={s.pick} onPress={async () => addPhotos(await pickFromCamera())} accessibilityRole="button">
          <Text style={s.pickText}>Take photo</Text>
        </Pressable>
        <Pressable style={s.pick} onPress={async () => addPhotos(await pickFromLibrary(true))} accessibilityRole="button">
          <Text style={s.pickText}>Camera roll</Text>
        </Pressable>
      </View>
      {hasPhotos && (
        <View style={s.thumbs}>
          {photos.map((p, i) => (
            <Image key={i} source={{ uri: p.uri }} style={s.thumb} />
          ))}
          <Pressable style={s.thumbClear} onPress={() => setPhotos([])} accessibilityRole="button" accessibilityLabel="Clear photos">
            <Text style={s.thumbClearText}>✕</Text>
          </Pressable>
        </View>
      )}
      <TextInput
        style={[s.describe, { minHeight: hasPhotos ? 64 : 104 }, Platform.OS === "web" && WEB_NO_RING]}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        placeholderTextColor={c.muted}
        placeholder={
          hasPhotos
            ? "Add context (optional) — e.g. the white sauce is toum, that's a 12oz steak, ignore the drink"
            : "Describe what you ate (or add a photo) — e.g. chicken breast + toum, skipped most of the salad but had the olives and feta"
        }
      />
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Pressable style={[s.btn, disabled && s.btnDim]} onPress={run} disabled={disabled} accessibilityRole="button">
        <Text style={s.btnText}>{busy ? "Analyzing…" : "Analyze with AI"}</Text>
      </Pressable>
      <Text style={s.meta}>
        {hasPhotos
          ? `${photos.length}/5 photos of one meal — AI estimates calories + protein.`
          : "Add a photo, a description, or both — AI estimates calories + protein."}
      </Text>
    </>
  );
}

// RNW draws a UA focus ring the border already replaces.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

const useS = makeStyles((c) =>
  StyleSheet.create({
    tabs: { flexDirection: "row", gap: 4, backgroundColor: c.field, borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 4 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
    tabOn: { backgroundColor: c.selected },
    tabText: { color: c.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 1 },
    tabTextOn: { color: c.fg },
    field: { gap: 6 },
    fieldLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    picks: { flexDirection: "row", gap: 8 },
    pick: {
      flex: 1, alignItems: "center", paddingVertical: 19, paddingHorizontal: 16,
      borderWidth: 1, borderStyle: "dashed", borderColor: c.line, borderRadius: 12, backgroundColor: c.raised,
    },
    pickText: { color: c.muted, fontSize: 12.5, fontFamily: "monospace", letterSpacing: 0.4 },
    thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    thumb: { width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.line },
    thumbClear: {
      width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: c.line,
      backgroundColor: c.card, alignItems: "center", justifyContent: "center",
    },
    thumbClearText: { color: c.muted, fontSize: 16 },
    describe: {
      borderWidth: 1, borderColor: c.line, borderRadius: 11, backgroundColor: c.field, color: c.fg,
      paddingHorizontal: 13, paddingVertical: 12, fontSize: 16, lineHeight: 23,
    },
    err: { color: c.error, fontSize: 14 },
    btn: { backgroundColor: c.amber, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
    btnDim: { opacity: 0.6 },
    btnText: { color: c.amberInk, fontWeight: "700", fontSize: 15 },
    ghostBtn: { borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    ghostBtnText: { color: c.fg, fontSize: 15 },
    meta: { color: c.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 0.2, lineHeight: 16 },
    insight: { color: c.fg, fontSize: 21, fontWeight: "600", letterSpacing: -0.4 },
    crow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12, paddingVertical: 9,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
    },
    crowLabel: { flex: 1, color: c.fg, fontSize: 14.5 },
    crowVal: { color: c.fg, fontSize: 14, fontFamily: "monospace" },
    unit: { color: c.muted, fontSize: 12 },
  }),
);
