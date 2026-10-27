import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, ScrollView } from "react-native";
import * as Clipboard from "expo-clipboard";
import { makeStyles, useTheme } from "./theme";
import { Sheet } from "./Sheet";
import { CopyIcon, CheckIcon, ExternalLinkIcon } from "./icons";

const MCP_URL = "https://app.skcal.fit/mcp";

// One-line value with a copy button, as in the web McpInstall / ApiKeys.
export function CopyField({ value, label = "Copy to clipboard" }: { value: string; label?: string }) {
  const s = useS();
  const { c } = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View style={s.copy}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.copyScroll}>
        <Text style={s.copyText} selectable>
          {value}
        </Text>
      </ScrollView>
      <Pressable
        style={s.copyBtn}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={async () => {
          try {
            await Clipboard.setStringAsync(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            // clipboard unavailable — the text is selectable
          }
        }}
      >
        {copied ? <CheckIcon size={16} color={c.muted} /> : <CopyIcon size={16} color={c.muted} />}
      </Pressable>
    </View>
  );
}

function Client({ title, href, hint, value }: { title: string; href?: string; hint: string; value: string }) {
  const s = useS();
  const { c } = useTheme();
  return (
    <View style={s.client}>
      {href ? (
        <Pressable style={s.clientLink} onPress={() => Linking.openURL(href)} accessibilityRole="link">
          <Text style={s.clientTitle}>{title}</Text>
          <ExternalLinkIcon size={13} color={c.muted} />
        </Pressable>
      ) : (
        <Text style={s.clientTitle}>{title}</Text>
      )}
      <Text style={s.meta}>{hint}</Text>
      <CopyField value={value} />
    </View>
  );
}

// Install instructions for connecting the skcal MCP server to popular clients.
export function McpInstall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useS();
  return (
    <Sheet open={open} title="Install the skcal MCP" onClose={onClose} saving={false} error={null} cancelLabel="Done">
      <Text style={s.meta}>
        Connect skcal to an AI client so it can log and query your data. You'll sign in once in the browser to
        authorize — no token to copy.
      </Text>
      <Client title="Claude Code" hint="Run this in your terminal:" value={`claude mcp add --transport http skcal ${MCP_URL}`} />
      <Client
        title="Claude (desktop & claude.ai)"
        href="https://claude.ai/settings/connectors"
        hint="Opens Connectors → Add custom connector, then paste the URL:"
        value={MCP_URL}
      />
      <Client
        title="ChatGPT"
        href="https://chatgpt.com/#settings/Connectors"
        hint="Opens Connectors (enable Developer mode) → Add, then paste the URL:"
        value={MCP_URL}
      />
    </Sheet>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    meta: { color: c.muted, fontSize: 12, fontFamily: "monospace", lineHeight: 17 },
    client: { gap: 6, marginTop: 6 },
    clientLink: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
    clientTitle: { color: c.fg, fontSize: 15, fontWeight: "600" },
    copy: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: c.field, borderWidth: 1, borderColor: c.line, borderRadius: 10,
      paddingLeft: 11, paddingVertical: 4, paddingRight: 4,
    },
    copyScroll: { flex: 1 },
    copyText: { color: c.fg, fontFamily: "monospace", fontSize: 12.5, paddingVertical: 6 },
    copyBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  }),
);
