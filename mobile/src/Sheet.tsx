import type { ReactNode } from "react";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  KeyboardAvoidingView, ActivityIndicator, Platform, type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "./theme";

// Bottom sheet for the small forms (log a weigh-in, add a measurement, fix a
// food item), styled like the Agent's photo-source sheet. The body scrolls so
// a landscape phone with the keyboard up can still reach Save. Without onSave
// it's a pick-and-close sheet: only the dismiss button (cancelLabel) shows.
export function Sheet({
  open,
  title,
  onClose,
  onSave,
  saving,
  error,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  saveDisabled = false,
  children,
}: {
  open: boolean;
  /** Omitted where the sheet leads with its own header (the add sheet's tabs). */
  title?: string;
  onClose: () => void;
  onSave?: () => void;
  saving: boolean;
  error: string | null;
  saveLabel?: string;
  cancelLabel?: string;
  saveDisabled?: boolean;
  children: ReactNode;
}) {
  const s = useS();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
      navigationBarTranslucent
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close">
          <Pressable
            style={[
              s.sheet,
              {
                paddingBottom: 12 + insets.bottom,
                marginLeft: insets.left,
                marginRight: insets.right,
                maxHeight: "100%",
                marginTop: insets.top + 12,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.body} bounces={false}>
              {title ? <Text style={s.title}>{title}</Text> : null}
              {children}
              {error ? <Text style={s.err}>{error}</Text> : null}
              <View style={s.actions}>
                <Pressable style={s.ghost} onPress={onClose} disabled={saving} accessibilityRole="button">
                  <Text style={s.ghostText}>{cancelLabel}</Text>
                </Pressable>
                {onSave && (
                  <Pressable
                    style={[s.btn, (saving || saveDisabled) && s.btnDim]}
                    onPress={onSave}
                    disabled={saving || saveDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={saveLabel}
                  >
                    {saving ? <ActivityIndicator color={c.amberInk} /> : <Text style={s.btnText}>{saveLabel}</Text>}
                  </Pressable>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  const s = useS();
  const { c } = useTheme();
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={c.dim}
        {...input}
        style={[s.input, Platform.OS === "web" && WEB_NO_RING, input.style]}
      />
    </View>
  );
}

// RNW draws a UA focus ring the border already replaces.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

const useS = makeStyles((c) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", alignItems: "center" },
    sheet: {
      width: "100%", maxWidth: 560,
      backgroundColor: c.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
      borderWidth: 1, borderColor: c.line,
    },
    body: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
    title: { color: c.fg, fontSize: 18, fontWeight: "700" },
    field: { gap: 6 },
    fieldLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    input: {
      borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.field, color: c.fg,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
    },
    err: { color: c.error, fontSize: 14 },
    // The web .sheet-actions: equal-width ghost + primary buttons.
    actions: { flexDirection: "row", gap: 10, marginTop: 4 },
    ghost: { flex: 1, alignItems: "center", borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingVertical: 13 },
    ghostText: { color: c.fg, fontSize: 15, fontWeight: "600" },
    btn: { flex: 1, backgroundColor: c.amber, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
    btnDim: { opacity: 0.6 },
    btnText: { color: c.amberInk, fontWeight: "700", fontSize: 15 },
  }),
);
