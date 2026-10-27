import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useTheme } from "./theme";
import { Sheet, Field } from "./Sheet";
import { useAccountSheetStyles } from "./ApiKeys";
import { TrashIcon } from "./icons";
import { listChannels, startPhoneLink, verifyPhoneLink, deleteChannel, type Channel } from "./api";

// Manage the phone numbers linked to this account. A linked, verified number
// can text the skcal iMessage agent and act on this account's data.
export function LinkedNumbers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useAccountSheetStyles();
  const { c } = useTheme();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listChannels().then(setChannels).catch(() => setChannels([]));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      await startPhoneLink(phone.trim());
      setStage("code");
    });

  const verify = () =>
    run(async () => {
      await verifyPhoneLink(phone.trim(), code.trim());
      setPhone("");
      setCode("");
      setStage("phone");
      load();
    });

  const remove = async (id: string) => {
    await deleteChannel(id).catch(() => {});
    load();
  };

  const primary = (label: string, onPress: () => void, disabled: boolean) => (
    <Pressable style={[s.btn, disabled && s.btnDim]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      {busy ? <ActivityIndicator color={c.amberInk} /> : <Text style={s.btnText}>{label}</Text>}
    </Pressable>
  );

  return (
    <Sheet open={open} title="Linked numbers" onClose={onClose} saving={false} error={null} cancelLabel="Done">
      <Text style={s.meta}>
        Text the skcal agent from a linked number and it acts on your account: log meals (even by photo), check your
        day, record weigh-ins.
      </Text>

      {stage === "phone" ? (
        <>
          <Field
            label="PHONE NUMBER"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+1 415 555 0123"
            maxLength={20}
          />
          {err ? <Text style={s.err}>{err}</Text> : null}
          {primary("Text me a code", sendCode, busy || !phone.trim())}
        </>
      ) : (
        <>
          <Field
            label={`CODE SENT TO ${phone}`}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            maxLength={10}
          />
          {err ? <Text style={s.err}>{err}</Text> : null}
          {primary("Verify & link", verify, busy || code.trim().length < 4)}
          <Pressable
            style={s.ghostBtn}
            disabled={busy}
            accessibilityRole="button"
            onPress={() => {
              setStage("phone");
              setCode("");
              setErr(null);
            }}
          >
            <Text style={s.ghostBtnText}>Use a different number</Text>
          </Pressable>
        </>
      )}

      <Text style={s.listLabel}>YOUR NUMBERS</Text>
      <View>
        {channels == null ? (
          <Text style={s.meta}>loading…</Text>
        ) : channels.length === 0 ? (
          <Text style={s.meta}>No numbers linked yet.</Text>
        ) : (
          channels.map((ch) => (
            <View style={s.row} key={ch.id}>
              <View style={s.rowMain}>
                <Text style={s.rowName}>{ch.value}</Text>
                <Text style={s.rowMeta}>
                  {ch.kind} · {ch.verified ? "verified" : "unverified"}
                </Text>
              </View>
              <Pressable style={s.iconBtn} onPress={() => remove(ch.id)} accessibilityRole="button" accessibilityLabel={`Unlink ${ch.value}`}>
                <TrashIcon size={16} color={c.muted} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </Sheet>
  );
}
