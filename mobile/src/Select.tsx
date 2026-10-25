import { useRef, useState } from "react";
import { Modal, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "./theme";
import { CheckIcon } from "./icons";

export type SelectOption = { value: string; label: string };

// The web Select (src/client/Select.tsx) as a field-styled trigger that opens
// a bottom list of options. Long lists (every exercise for a muscle) scroll
// inside the sheet.
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessibility label for the trigger, and the sheet's heading. */
  label: string;
}) {
  const s = useS();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <Pressable style={s.trigger} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? "none"}`}>
        <Text style={s.triggerText} numberOfLines={1}>
          {current?.label ?? "—"}
        </Text>
        <Text style={s.chev}>▾</Text>
      </Pressable>
      <OptionSheet open={open} title={label} options={options} value={value} onClose={() => setOpen(false)} onPick={onChange} />
    </>
  );
}

// Bottom list of choices, styled like the Agent's photo-source sheet: a
// Select's options, or a menu of actions (no `value`). Picking closes it.
// iOS can't present a modal while another is still animating out, and a pick
// often opens one (a menu's "Rate chest" opens the feedback sheet), so there
// the pick runs once this sheet has finished dismissing.
export function OptionSheet({
  open,
  title,
  options,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  options: SelectOption[];
  value?: string;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pending = useRef<string | null>(null);
  const pick = (v: string) => {
    onClose();
    if (Platform.OS === "ios") pending.current = v;
    else onPick(v);
  };
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => {
        const v = pending.current;
        pending.current = null;
        if (v != null) onPick(v);
      }}
      supportedOrientations={["portrait", "landscape"]}
      navigationBarTranslucent
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={[s.sheet, { paddingBottom: 12 + insets.bottom, marginLeft: insets.left, marginRight: insets.right, marginTop: insets.top + 40 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={s.title}>{title.toUpperCase()}</Text>
          <ScrollView bounces={false}>
            {options.map((o, i) => {
              const on = value !== undefined && o.value === value;
              return (
                <Pressable
                  key={o.value}
                  style={[s.option, i > 0 && s.optionBorder]}
                  onPress={() => pick(o.value)}
                  accessibilityRole={value !== undefined ? "radio" : "button"}
                  accessibilityState={value !== undefined ? { selected: on } : undefined}
                >
                  <Text style={[s.optionText, on && s.optionOn]}>{o.label}</Text>
                  {on && <CheckIcon size={16} color={c.amberText} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    trigger: {
      flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0,
      borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.field,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    triggerText: { flex: 1, color: c.fg, fontSize: 15 },
    chev: { color: c.muted, fontSize: 12 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", alignItems: "center" },
    sheet: {
      width: "100%", maxWidth: 560, maxHeight: "80%",
      backgroundColor: c.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
      borderWidth: 1, borderColor: c.line, paddingTop: 14, paddingHorizontal: 8,
    },
    title: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, paddingHorizontal: 14, paddingBottom: 6 },
    option: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
    optionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    optionText: { flex: 1, color: c.fg, fontSize: 16 },
    optionOn: { color: c.amberText, fontWeight: "600" },
  }),
);
