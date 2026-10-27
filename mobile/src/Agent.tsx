import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, Image, Animated, Easing,
  AccessibilityInfo, KeyboardAvoidingView, Platform, Modal, type TextStyle,
} from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import { makeStyles, useTheme, type Palette } from "./theme";
import { agentStream, photoSource, type AgentStreamPart, type ChatMessage, type ChatPart } from "./api";
import { imageTypeOf, pickFromCamera, pickFromLibrary } from "./image";
import { ArrowUpIcon, CameraIcon, CheckIcon, ImagePlusIcon, LoaderIcon, StopIcon, XIcon } from "./icons";

// A thread message: persisted ones carry text/photo parts; a reply streamed
// this session also keeps its tool calls in order (web: assistant-ui parts).
type ThreadPart = ChatPart | AgentStreamPart;
type ThreadMessage = { role: "user" | "assistant"; content: string | ThreadPart[] };

const partsOf = (m: ThreadMessage): ThreadPart[] =>
  typeof m.content === "string" ? (m.content ? [{ type: "text", text: m.content }] : []) : m.content;

// What the worker sees, mirroring the web adapter: text and de-duplicated
// photos only (tool calls stay local), a plain string when there's no photo,
// and empty messages dropped.
function toHistory(messages: ThreadMessage[]): ChatMessage[] {
  return messages
    .map((m): ChatMessage => {
      const parts: ChatPart[] = [];
      const seen = new Set<string>();
      for (const p of partsOf(m)) {
        if (p.type === "text" && p.text.trim()) parts.push({ type: "text", text: p.text });
        else if (p.type === "image" && !seen.has(p.image)) {
          seen.add(p.image);
          parts.push(p);
        }
      }
      const hasImage = parts.some((p) => p.type === "image");
      return {
        role: m.role,
        content: hasImage ? parts : parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
      };
    })
    .filter((m) => (typeof m.content === "string" ? m.content.trim().length > 0 : m.content.length > 0));
}

// Same copy as the web thread when the request itself can't go out.
const SEND_FAILED = "That message didn't go through, give it another try in a moment.";

const TOOL_LABELS: Record<string, string> = {
  list_food_log: "Reading food log",
  move_meal: "Moving meal",
  move_food_item: "Moving food",
  delete_meal: "Deleting meal",
  delete_food_item: "Deleting food",
  edit_food_item: "Fixing entry",
  log_meal: "Logging meal",
  log_measurement: "Logging measurement",
  log_weight: "Logging weight",
  log_workout: "Logging workout",
  query_user_data: "Looking through your data",
  get_weight_history: "Reading weight history",
  set_targets: "Updating targets",
  remember: "Saving to memory",
  forget_memory: "Forgetting",
  set_reminder: "Setting reminder",
  update_reminder: "Updating reminder",
  list_reminders: "Reading reminders",
  delete_reminder: "Deleting reminder",
};

// RNW has no native animated module; the JS driver runs the same animation.
const NATIVE_DRIVER = Platform.OS !== "web";

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

// One of the three Thinking dots: rises and brightens in turn (web's
// thinking-dot keyframes, 1.2s cycle, 0.15s stagger). Reduced motion keeps
// them still at a steady 0.6 opacity.
function Dot({ delay, reduce }: { delay: number; reduce: boolean }) {
  const s = useS();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const step = (toValue: number) =>
      Animated.timing(t, { toValue, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER });
    const anim = Animated.loop(
      Animated.sequence([Animated.delay(delay), step(1), step(0), Animated.delay(480 - delay)]),
    );
    anim.start();
    return () => anim.stop();
  }, [t, delay, reduce]);
  const style = reduce
    ? { opacity: 0.6 }
    : {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -2.4] }) }],
      };
  return <Animated.View style={[s.dot, style]} />;
}

// Shown while the coach is working but nothing visible is streaming: before
// the first token and after a tool finishes, while the next turn thinks. A
// still-running tool chip shows its own spinner instead.
function Thinking({ afterTool }: { afterTool: boolean }) {
  const s = useS();
  const reduce = useReduceMotion();
  return (
    <View
      style={[s.thinking, afterTool && s.afterTool]}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Thinking"
    >
      <View style={s.dots}>
        <Dot delay={0} reduce={reduce} />
        <Dot delay={150} reduce={reduce} />
        <Dot delay={300} reduce={reduce} />
      </View>
      <Text style={s.thinkingText}>Thinking</Text>
    </View>
  );
}

function Spinner({ size, color }: { size: number; color: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
    );
    anim.start();
    return () => anim.stop();
  }, [t]);
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <LoaderIcon size={size} color={color} />
    </Animated.View>
  );
}

// Compact chip for a coach tool call — spinner while running, check when done.
function ToolChip({ name, done }: { name: string; done: boolean }) {
  const s = useS();
  const { c } = useTheme();
  const label = TOOL_LABELS[name] ?? name;
  return (
    <View style={s.toolChip} accessibilityLabel={done ? `${label}, done` : label}>
      {done ? <CheckIcon size={13.6} color={c.amberText} /> : <Spinner size={13.6} color={c.muted} />}
      <Text style={[s.toolChipText, done && s.toolChipTextDone]}>{label}</Text>
    </View>
  );
}

// A sent photo at its own aspect ratio, capped like the web's .bubble-photo
// (220 wide, 260 tall). Photos need the bearer header — the API serves them
// per-user — so photoSource builds the source.
const PHOTO_MAX_W = 220;
const PHOTO_MAX_H = 260;
function Photo({ image }: { image: string }) {
  const s = useS();
  const [size, setSize] = useState({ width: PHOTO_MAX_W, height: PHOTO_MAX_W });
  return (
    <Image
      style={[s.photo, size]}
      source={photoSource(image)}
      resizeMode="cover"
      accessibilityLabel="attached photo"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source;
        if (!width || !height) return;
        const scale = Math.min(1, PHOTO_MAX_W / width, PHOTO_MAX_H / height);
        setSize({ width: Math.round(width * scale), height: Math.round(height * scale) });
      }}
    />
  );
}

// User turns are a compact amber pill on the right (photos, then plain text);
// assistant turns are plain full-width markdown with tool chips inline, no
// bubble — the web thread's ChatGPT-style layout.
function Message({ item, running }: { item: ThreadMessage; running: boolean }) {
  const s = useS();
  const md = useMd();
  const parts = partsOf(item);
  if (item.role === "user") {
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n");
    return (
      <View style={s.user}>
        {parts.map((p, i) => (p.type === "image" ? <Photo key={i} image={p.image} /> : null))}
        {text ? <Text style={s.userText}>{text}</Text> : null}
      </View>
    );
  }
  const last = parts[parts.length - 1];
  // Thinking shows while running and nothing is streaming: no parts yet, or
  // the reply ends on a finished tool call.
  const thinking = running && (!last || (last.type === "tool" && last.done));
  return (
    <View style={s.assistant}>
      {parts.map((p, i) => {
        const afterTool = parts[i - 1]?.type === "tool";
        if (p.type === "tool") return <ToolChip key={i} name={p.name} done={p.done} />;
        if (p.type === "image") return <Photo key={i} image={p.image} />;
        if (!p.text) return null;
        // assistant replies render markdown (bold, lists, links, code) so the
        // raw ** and #'s from the model don't leak through
        return (
          <View key={i} style={afterTool && s.afterTool}>
            <Markdown style={md}>{p.text}</Markdown>
          </View>
        );
      })}
      {thinking && <Thinking afterTool={last?.type === "tool"} />}
    </View>
  );
}

// Picker result → data URL the worker's vision path accepts directly.
const toDataUrl = (a: ImagePickerAsset): string | null => {
  if (a.uri.startsWith("data:")) return a.uri;
  if (a.base64) return `data:${imageTypeOf(a.base64)};base64,${a.base64}`;
  return null;
};

// Chrome's UA focus ring uses outline-style auto, which shrugs off a zero
// width — it has to be styled away. RNW supports outlineStyle; RN types don't.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;

// The live agent thread. Seeded from a saved conversation (or empty for a new
// chat); streams from the coach endpoint, which saves each turn as it runs
// (a stopped one too), so web and mobile see the same chats. The parent
// remounts it per session key.
export function Agent({
  initialMessages,
  initialConversationId,
  onPersisted,
  keyboardOffset,
}: {
  initialMessages: ChatMessage[];
  initialConversationId: string | null;
  onPersisted: (id: string) => void;
  keyboardOffset: number;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string[]>([]); // data URLs awaiting send
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = useS();
  const { c } = useTheme();
  const list = useRef<FlatList<ThreadMessage>>(null);
  const convIdRef = useRef<string | null>(initialConversationId);
  const abortRef = useRef<AbortController | null>(null);
  const insets = useSafeAreaInsets();

  const addAssets = (assets: ImagePickerAsset[]) => {
    const urls = assets.map(toDataUrl).filter((u): u is string => !!u);
    if (urls.length) setPending((p) => [...p, ...urls].slice(0, 4)); // worker caps 4/message
  };

  const pickLibrary = async () => {
    setSheetOpen(false);
    addAssets(await pickFromLibrary(true));
  };

  const pickCamera = async () => {
    setSheetOpen(false);
    addAssets(await pickFromCamera());
  };

  const canSend = (input.trim().length > 0 || pending.length > 0) && !busy;

  const send = async () => {
    if (!canSend) return;
    const text = input.trim();
    const photos = pending;
    const content: string | ChatPart[] = photos.length
      ? [...(text ? [{ type: "text" as const, text }] : []), ...photos.map((image) => ({ type: "image" as const, image }))]
      : text;
    const next: ThreadMessage[] = [...messages, { role: "user", content }];
    const reply = (parts: ThreadPart[]) => setMessages([...next, { role: "assistant", content: parts }]);
    reply([]); // the live reply: Thinking until the first part arrives
    setInput("");
    setPending([]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // The worker caps history at 20 messages; send the newest window,
    // opened on a user message (mirrors the web client).
    let window = toHistory(next).slice(-20);
    while (window.length && window[0]?.role !== "user") window = window.slice(1);
    try {
      // Stream the reply into the live assistant message; each change
      // re-renders its text and tool chips in place.
      const res = await agentStream(window, convIdRef.current, reply, ctrl.signal);
      reply(res.parts);
      if (res.conversationId) convIdRef.current = res.conversationId;
      // The server has saved the turn (a stopped one too): refresh history.
      if (convIdRef.current) onPersisted(convIdRef.current);
    } catch {
      reply([{ type: "text", text: SEND_FAILED }]);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    // padding on Android too — the window doesn't resize under edge-to-edge,
    // so without it the keyboard covers the chat input (same bug as SignIn).
    <KeyboardAvoidingView
      style={s.wrap}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <FlatList
        ref={list}
        style={s.list}
        contentContainerStyle={s.listContent}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => <Message item={item} running={busy && index === messages.length - 1} />}
        // Home state: greeting centered in the viewport, composer docked below.
        ListEmptyComponent={
          <View style={s.welcome}>
            <Text style={s.welcomeTitle}>Ask before you eat.</Text>
          </View>
        }
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      />
      {/* Mirrors the web composer: one pill — pending photo chips on top, the
          input full-width, then a controls row with attach bottom-left and
          send/stop bottom-right. Typing and attaching stay open while the
          coach replies; only sending waits. */}
      <View style={[s.composerWrap, { paddingBottom: 6.4 + insets.bottom }]}>
        <View style={[s.composer, focused && s.composerFocused]}>
          {pending.length > 0 && (
            <View style={s.chips}>
              {pending.map((uri, i) => (
                <View key={i} style={s.chip}>
                  <Image style={s.chipThumb} source={{ uri }} />
                  <Pressable
                    style={({ pressed }) => [s.chipRemove, pressed && s.pressedSmall]}
                    onPress={() => setPending((p) => p.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove photo"
                    hitSlop={6}
                  >
                    <XIcon size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <TextInput
            style={[s.input, Platform.OS === "web" && WEB_NO_RING]}
            placeholder="What are you thinking of eating?"
            placeholderTextColor={c.muted}
            value={input}
            onChangeText={setInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
          />
          <View style={s.controls}>
            <Pressable
              style={({ pressed }) => [s.attach, pressed && s.attachPressed]}
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
            >
              <CameraIcon size={19} color={c.muted} />
            </Pressable>
            {busy ? (
              <Pressable
                style={({ pressed }) => [s.send, s.stop, pressed && s.pressed]}
                onPress={stop}
                accessibilityRole="button"
                accessibilityLabel="Stop"
              >
                <StopIcon size={16.8} color={c.bg} />
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [s.send, !canSend && s.sendDisabled, pressed && canSend && s.pressed]}
                onPress={send}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !canSend }}
              >
                <ArrowUpIcon size={16.8} color={canSend ? c.amberInk : c.muted} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Two-option source sheet, same as the web composer's. */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
        supportedOrientations={["portrait", "landscape"]}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable
            style={[s.sheet, { paddingBottom: 11.2 + insets.bottom, marginLeft: insets.left, marginRight: insets.right }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityLabel="Add a photo"
          >
            {Platform.OS !== "web" && (
              <Pressable style={({ pressed }) => [s.sheetOption, pressed && s.sheetOptionPressed]} onPress={pickCamera}>
                <CameraIcon size={20} color={c.muted} />
                <Text style={s.sheetOptionText}>Take photo</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [s.sheetOption, Platform.OS !== "web" && s.sheetOptionBorder, pressed && s.sheetOptionPressed]}
              onPress={pickLibrary}
            >
              <ImagePlusIcon size={20} color={c.muted} />
              <Text style={s.sheetOptionText}>Photo library</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// Sizes translate the web's rem values at a 16px root (.bubble 0.95rem/1.5,
// .tool-chip 0.72rem, .chat-welcome-title 1.5rem, ...).
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const useS = makeStyles((C: Palette) =>
  StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14.4, gap: 14.4, flexGrow: 1 },
  welcome: { flex: 1, justifyContent: "center", padding: 16 },
  welcomeTitle: { color: C.fg, textAlign: "center", fontSize: 24, fontWeight: "600", lineHeight: 30 },
  user: {
    alignSelf: "flex-end", maxWidth: "80%", backgroundColor: C.amber, borderRadius: 18,
    paddingHorizontal: 13.6, paddingVertical: 7.2,
  },
  userText: { color: C.amberInk, fontSize: 15.2, lineHeight: 22.8 },
  assistant: { alignSelf: "stretch", paddingHorizontal: 1.6, paddingTop: 1.6, paddingBottom: 6.4 },
  // whatever follows a tool chip gets the paragraph gap the text above it has
  afterTool: { marginTop: 8 },
  photo: { borderRadius: 12, marginBottom: 6, backgroundColor: C.line },
  thinking: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 8 },
  dots: { flexDirection: "row", gap: 3.2 },
  dot: { width: 4.8, height: 4.8, borderRadius: 2.4, backgroundColor: C.muted },
  thinkingText: { color: C.muted, fontFamily: MONO, fontSize: 13.1, letterSpacing: 0.26 },
  toolChip: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6.4,
    marginVertical: 2.4, paddingHorizontal: 9.6, paddingVertical: 4.8,
    borderWidth: 1, borderColor: C.line, borderRadius: 999, backgroundColor: C.field,
  },
  toolChipText: { color: C.muted, fontFamily: MONO, fontSize: 11.5, letterSpacing: 0.23 },
  toolChipTextDone: { color: C.fg },
  composerWrap: { paddingHorizontal: 16, paddingTop: 9.6, backgroundColor: C.bg },
  composer: {
    borderWidth: 1, borderColor: C.line, borderRadius: 22, backgroundColor: C.field,
    paddingHorizontal: 7.2, paddingTop: 7.2, paddingBottom: 6.4, gap: 2.4,
  },
  composerFocused: { borderColor: C.amberText },
  chips: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 5.6, paddingTop: 2.4 },
  chip: { position: "relative", marginTop: 2, marginRight: 8, marginBottom: 8 },
  chipThumb: { width: 92, height: 92, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised },
  chipRemove: {
    position: "absolute", top: 5, right: 5, width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
  },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6.4 },
  input: {
    width: "100%", color: C.fg,
    paddingHorizontal: 8, paddingTop: 5.6, paddingBottom: 2.4, fontSize: 16, lineHeight: 22.4, maxHeight: 140,
  },
  attach: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  attachPressed: { backgroundColor: C.selected },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: C.line },
  stop: { backgroundColor: C.fg },
  pressed: { transform: [{ scale: 0.94 }] },
  pressedSmall: { transform: [{ scale: 0.92 }] },
  sheetBackdrop: { flex: 1, backgroundColor: C.scrim, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%", maxWidth: 560,
    backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: C.line, paddingTop: 8.8, paddingHorizontal: 9.6,
  },
  sheetOption: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12.8, paddingHorizontal: 11.2 },
  sheetOptionPressed: { transform: [{ scale: 0.98 }] },
  sheetOptionBorder: { borderTopWidth: 1, borderTopColor: C.line },
  sheetOptionText: { color: C.fg, fontSize: 15.2 },
  }),
);

// Themed markdown for assistant replies. body's text props (color, size,
// line height) cascade down to every text leaf via the renderer, matching the
// web's 0.95rem / 1.5 bubble text; only element-specific tweaks are
// overridden below (web: .bubble-assistant p/ul/li/strong/code).
const useMd = makeStyles((C: Palette) =>
  StyleSheet.create({
  body: { color: C.fg, fontSize: 15.2, lineHeight: 22.8 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: "600", color: C.fg },
  em: { fontStyle: "italic" },
  link: { color: C.amberText, textDecorationLine: "underline" },
  heading1: { color: C.fg, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  heading2: { color: C.fg, fontSize: 18, fontWeight: "700", marginBottom: 6 },
  heading3: { color: C.fg, fontSize: 16.5, fontWeight: "700", marginBottom: 4 },
  bullet_list: { marginVertical: 4.8 },
  ordered_list: { marginVertical: 4.8 },
  list_item: { marginVertical: 2.4 },
  hr: { backgroundColor: C.line, height: 1, marginVertical: 8 },
  blockquote: {
    backgroundColor: C.bg, borderLeftWidth: 3, borderLeftColor: C.line,
    borderColor: C.line, marginLeft: 0, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  code_inline: {
    backgroundColor: C.selected, color: C.fg, borderWidth: 0,
    borderRadius: 5, paddingHorizontal: 4.8, fontFamily: MONO, fontSize: 12.9,
  },
  code_block: {
    backgroundColor: C.selected, color: C.fg, borderWidth: 0,
    borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 12.9,
  },
  fence: {
    backgroundColor: C.selected, color: C.fg, borderWidth: 0,
    borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 12.9, marginBottom: 8,
  },
  table: { borderColor: C.line, borderRadius: 6 },
  tr: { borderColor: C.line },
  }),
);
