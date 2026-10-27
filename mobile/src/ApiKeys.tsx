import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { makeStyles, useTheme } from "./theme";
import { Sheet, Field } from "./Sheet";
import { CopyField } from "./McpInstall";
import { CheckIcon, TrashIcon } from "./icons";
import { listApiKeys, createApiKey, deleteApiKey, API_SCOPES, type ApiKey } from "./api";

// Group scopes by resource for the limit-scope checkboxes.
const SCOPE_GROUPS = API_SCOPES.reduce<Record<string, string[]>>((acc, sc) => {
  const resource = sc.split(":")[0];
  (acc[resource] ??= []).push(sc);
  return acc;
}, {});

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Check({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  const s = useS();
  const { c } = useTheme();
  return (
    <Pressable style={s.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} hitSlop={4}>
      <View style={[s.box, checked && s.boxOn]}>{checked && <CheckIcon size={12} color={c.amberInk} />}</View>
      <Text style={s.checkText}>{label}</Text>
    </Pressable>
  );
}

// The web ApiKeys modal: create a bearer token (full access or limited
// scopes), see it once, and revoke existing keys.
export function ApiKeys({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(() => {
    listApiKeys().then(setKeys).catch(() => setKeys([]));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const toggle = (scope: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(scope) ? next.delete(scope) : next.add(scope);
      return next;
    });

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const scopes = limit ? [...selected] : ["*"];
      if (limit && scopes.length === 0) throw new Error("Pick at least one scope, or use full access.");
      const key = await createApiKey(name.trim(), scopes);
      setCreated({ name: key.name, token: key.token });
      setName("");
      setLimit(false);
      setSelected(new Set());
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteApiKey(id).catch(() => {});
    load();
  };

  return (
    <Sheet open={open} title="API keys" onClose={onClose} saving={false} error={null} cancelLabel="Done">
      <Text style={s.meta}>
        Bearer tokens for the HTTP API — send as <Text style={s.code}>Authorization: Bearer skcal_…</Text>. Keys
        default to full access; limit the scope below.
      </Text>

      {created && (
        <View style={s.created}>
          <Text style={s.createdTitle}>Copy your new key now — it won't be shown again.</Text>
          <CopyField value={created.token} label="Copy key" />
          <Pressable style={s.smBtn} onPress={() => setCreated(null)} accessibilityRole="button">
            <Text style={s.smBtnText}>Done</Text>
          </Pressable>
        </View>
      )}

      <Field label="NEW KEY NAME" value={name} onChangeText={setName} placeholder="e.g. laptop script" maxLength={80} />
      <Check checked={limit} label="Limit scope (default: full access)" onPress={() => setLimit((v) => !v)} />
      {limit && (
        <View style={s.scopes}>
          {Object.entries(SCOPE_GROUPS).map(([resource, scopes]) => (
            <View style={s.scopeGroup} key={resource}>
              <Text style={s.scopeRes}>{resource.toUpperCase()}</Text>
              {scopes.map((sc) => (
                <Check key={sc} checked={selected.has(sc)} label={sc.split(":")[1]} onPress={() => toggle(sc)} />
              ))}
            </View>
          ))}
        </View>
      )}
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Pressable
        style={[s.btn, (busy || !name.trim()) && s.btnDim]}
        onPress={create}
        disabled={busy || !name.trim()}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={c.amberInk} /> : <Text style={s.btnText}>Create key</Text>}
      </Pressable>

      <Text style={s.listLabel}>YOUR KEYS</Text>
      <View>
        {keys == null ? (
          <Text style={s.meta}>loading…</Text>
        ) : keys.length === 0 ? (
          <Text style={s.meta}>No API keys yet.</Text>
        ) : (
          keys.map((k) => (
            <View style={s.row} key={k.id}>
              <View style={s.rowMain}>
                <Text style={s.rowName}>{k.name}</Text>
                <Text style={s.rowMeta}>
                  <Text style={s.code}>{k.prefix}</Text> · {k.scopes.includes("*") ? "full access" : `${k.scopes.length} scopes`} ·{" "}
                  {k.lastUsedAt ? `used ${fmtDate(k.lastUsedAt)}` : "never used"}
                </Text>
              </View>
              <Pressable style={s.iconBtn} onPress={() => remove(k.id)} accessibilityRole="button" accessibilityLabel={`Revoke ${k.name}`}>
                <TrashIcon size={16} color={c.muted} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </Sheet>
  );
}

export const useAccountSheetStyles = makeStyles((c) =>
  StyleSheet.create({
    meta: { color: c.muted, fontSize: 12, fontFamily: "monospace", lineHeight: 17 },
    code: { fontFamily: "monospace", color: c.fg },
    err: { color: c.error, fontSize: 14 },
    btn: { backgroundColor: c.amber, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
    btnDim: { opacity: 0.6 },
    btnText: { color: c.amberInk, fontWeight: "700", fontSize: 15 },
    ghostBtn: { borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    ghostBtnText: { color: c.fg, fontSize: 15 },
    listLabel: { color: c.muted, fontFamily: "monospace", fontSize: 10, letterSpacing: 1, marginTop: 8 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 3,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 2 },
    rowName: { color: c.fg, fontSize: 14.5 },
    rowMeta: { color: c.muted, fontSize: 12 },
    iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  }),
);

const useOwn = makeStyles((c) =>
  StyleSheet.create({
    created: { gap: 8, padding: 12, borderWidth: 1, borderColor: c.amberText, borderRadius: 12, backgroundColor: "rgba(245,158,11,0.08)" },
    createdTitle: { color: c.fg, fontSize: 13.5 },
    smBtn: { alignSelf: "flex-start", borderWidth: 1, borderColor: c.line, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 12 },
    smBtnText: { color: c.fg, fontSize: 13 },
    check: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 3 },
    box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: c.dim, alignItems: "center", justifyContent: "center" },
    boxOn: { backgroundColor: c.amber, borderColor: c.amber },
    checkText: { color: c.fg, fontSize: 13.5 },
    scopes: { gap: 10, padding: 12, borderWidth: 1, borderColor: c.line, borderRadius: 10 },
    scopeGroup: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 4 },
    scopeRes: { width: 104, color: c.muted, fontFamily: "monospace", fontSize: 11, letterSpacing: 0.6 },
  }),
);

const useS = () => ({ ...useAccountSheetStyles(), ...useOwn() });
