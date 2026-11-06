import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  AttachmentPrimitive,
  useAttachment,
  useAuiState,
  useComposerRuntime,
  SimpleImageAttachmentAdapter,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type EmptyMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp, Square, Camera, Check, ImagePlus, Loader2, X } from "lucide-react";
import { api, todayLocal } from "./api";
import type { CoachMessage, CoachConversation } from "./api";

// ---- Shared conversation history (lives at the app level so the global nav
// drawer and the coach view both read/drive the same state) -----------------
export type CoachSession = { key: string; convId: string | null; messages: CoachMessage[] };

export function useCoachHistory() {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  // True once the first listConversations attempt settles — deep links wait on
  // this before deciding whether the URL's conversation id exists.
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const nonceRef = useRef(0);
  const [session, setSession] = useState<CoachSession>({ key: "new-0", convId: null, messages: [] });

  const load = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      /* history is best-effort */
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const newChat = useCallback(() => {
    nonceRef.current += 1;
    setSession({ key: `new-${nonceRef.current}`, convId: null, messages: [] });
  }, []);
  const openConversation = useCallback((conv: CoachConversation) => {
    setSession({ key: conv.id, convId: conv.id, messages: conv.messages });
  }, []);
  // Open a conversation by id (URL deep links / Back-Forward). Looks in the
  // full (unfiltered) list; false when the id is unknown so the caller can
  // fall back to a fresh chat.
  const openById = useCallback(
    (id: string) => {
      const conv = conversations.find((x) => x.id === id);
      if (conv) openConversation(conv);
      return conv !== undefined;
    },
    [conversations, openConversation],
  );
  const onPersisted = useCallback(
    (id: string) => {
      setSession((s) => (s.convId ? s : { ...s, convId: id }));
      load();
    },
    [load],
  );
  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
      } catch {
        /* ignore */
      }
      if (session.convId === id) newChat();
      else load();
    },
    [session.convId, newChat, load],
  );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q)),
      )
    : conversations;

  return {
    conversations: filtered,
    activeId: session.convId,
    loaded,
    session,
    search,
    setSearch,
    hasQuery: !!q,
    newChat,
    openConversation,
    openById,
    onPersisted,
    removeConversation,
  };
}
export type CoachHistory = ReturnType<typeof useCoachHistory>;

const MarkdownText = () => <MarkdownTextPrimitive className="coach-md" />;

const TOOL_LABELS: Record<string, string> = {
  list_food_log: "Reading food log",
  move_meal: "Moving meal",
  move_food_item: "Moving food",
  delete_meal: "Deleting meal",
  delete_food_item: "Deleting food",
  delete_weigh_in: "Deleting weigh-in",
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
  set_profile: "Saving your profile",
  finish_onboarding: "Finishing setup",
  get_phases: "Reading your plan",
  start_phase: "Starting your plan",
  update_phase: "Updating your plan",
  end_phase: "Ending your plan",
  list_exercises: "Browsing exercises",
  create_mesocycle: "Building your program",
  get_training_session: "Reading your workout",
  log_sets: "Logging sets",
  set_muscle_feedback: "Saving feedback",
  complete_session: "Finishing workout",
  swap_exercise: "Swapping exercise",
  end_mesocycle: "Ending program",
  update_mesocycle: "Updating program",
  delete_mesocycle: "Deleting program",
  add_training_day: "Adding a workout",
  update_training_day: "Updating workout",
  delete_training_day: "Deleting workout",
  add_day_exercise: "Adding exercise",
  remove_day_exercise: "Removing exercise",
  add_set: "Adding a set",
  edit_set: "Fixing set",
  delete_set: "Deleting set",
};

// First-run setup: the agent interviews a new account, opening with this
// question and its answers as chips (the worker's ONBOARDING_RULES expect it).
const ONBOARDING_GREETING_TEXT = "Hey, I'm your skcal coach. I'll set up your calories and plan in about a minute. What are you here for?";
const ONBOARDING_GOALS = ["Lose fat", "Build muscle", "Maintain my weight", "Just track my lifts"];
const GREETING_CALL_ID = "onboarding-greeting";

// Lets the greeting's chips offer "Skip setup" without threading props through
// assistant-ui's part renderers.
const OnboardingContext = createContext<{ onSkip?: () => void }>({});

// The agent's quick replies (its offer_choices call): tap to send. Only the
// newest reply's choices are live, and only once it has finished.
function ChoicesTool({ args, toolCallId }: ToolCallMessagePartProps) {
  const { onSkip } = useContext(OnboardingContext);
  const options = Array.isArray(args.options) ? (args.options as unknown[]).filter((o): o is string => typeof o === "string") : [];
  if (!options.length) return null;
  return (
    <MessagePrimitive.If last>
      <ThreadPrimitive.If running={false}>
        <div className="quick-replies">
          {options.map((o) => (
            <ThreadPrimitive.Suggestion key={o} prompt={o} send className="quick-reply">
              {o}
            </ThreadPrimitive.Suggestion>
          ))}
          {toolCallId === GREETING_CALL_ID && onSkip && (
            <button type="button" className="quick-skip" onClick={onSkip}>
              Skip setup
            </button>
          )}
        </div>
      </ThreadPrimitive.If>
    </MessagePrimitive.If>
  );
}

// Shown while the coach is working but nothing visible is streaming: before
// the first token (the model always thinks first) and after a tool finishes,
// while the next turn thinks. assistant-ui renders Empty when a running
// message has no parts or ends on a non-text part; a still-running tool chip
// already shows its own spinner, so skip that case.
function Thinking({ status }: EmptyMessagePartProps) {
  const toolRunning = useAuiState((s) => {
    const last = s.message.parts[s.message.parts.length - 1];
    return last?.type === "tool-call" && last.result === undefined;
  });
  if (status.type !== "running" || toolRunning) return null;
  return (
    <div className="bubble-thinking" role="status">
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      Thinking
    </div>
  );
}

// Compact chip for a coach tool call — spinner while running, check when done.
function ToolFallback({ toolName, result }: { toolName: string; result?: unknown }) {
  const done = result !== undefined;
  return (
    <div className={`tool-chip ${done ? "done" : "running"}`}>
      {done ? <Check className="tool-chip-icon" /> : <Loader2 className="tool-chip-icon spin" />}
      <span>{TOOL_LABELS[toolName] ?? toolName}</span>
    </div>
  );
}

function ImagePart({ image }: { image?: string }) {
  if (!image) return null;
  return <img className="bubble-photo" src={image} alt="attached photo" />;
}

// Sent photos live on message.attachments (not content parts), so the bubble
// needs its own renderer to show them.
function SentPhoto() {
  const attachment = useAttachment();
  const image = attachment.content?.find(
    (p): p is { type: "image"; image: string } => p.type === "image",
  )?.image;
  return <ImagePart image={image} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-user">
      <MessagePrimitive.Attachments components={{ Attachment: SentPhoto }} />
      <MessagePrimitive.Parts components={{ Image: ImagePart }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-assistant">
      <MessagePrimitive.Parts
        components={{ Text: MarkdownText, Empty: Thinking, tools: { by_name: { offer_choices: ChoicesTool }, Fallback: ToolFallback } }}
      />
    </MessagePrimitive.Root>
  );
}

// Pending photo preview: a large rounded thumbnail with the remove control
// floating on its corner (no filename), built from the picked file directly.
function AttachmentChip() {
  const attachment = useAttachment();
  const file = (attachment as { file?: File }).file;
  const src = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);
  return (
    <AttachmentPrimitive.Root className="attach-chip">
      {src ? <img className="attach-thumb" src={src} alt="" /> : <div className="attach-thumb" />}
      <AttachmentPrimitive.Remove className="attach-remove" aria-label="Remove photo">
        <X />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

// Phone camera JPEGs routinely exceed the worker's ~8MB image cap and 400 the
// whole turn, so photos are downscaled before they enter the composer. Large
// files re-encode to JPEG capped at 1600px on the long edge; anything small,
// undecodable (e.g. HEIC), or that fails mid-resize passes through unchanged.
const PHOTO_BYTE_LIMIT = 2_500_000;
const PHOTO_MAX_EDGE = 1600;
async function downscalePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= PHOTO_BYTE_LIMIT) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// One visible attach button that opens our own source sheet instead of the
// native picker. iOS hides "Take Photo" for multi-select file inputs, so a
// single input can't offer both the camera and library multi-select — each
// option gets its own hidden input behind the sheet.
function AttachButton() {
  const composer = useComposerRuntime();
  const [open, setOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    for (const file of Array.from(input.files ?? [])) await composer.addAttachment(await downscalePhoto(file));
    input.value = ""; // so re-picking the same file fires change again
  };

  const pick = (ref: RefObject<HTMLInputElement | null>) => {
    setOpen(false);
    ref.current?.click();
  };

  return (
    <>
      <button type="button" className="composer-attach" aria-label="Add a photo" onClick={() => setOpen(true)}>
        <Camera />
      </button>
      {/* capture opens the camera directly on phones (file dialog on desktop) */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPicked} />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={onPicked} />
      {open &&
        createPortal(
          <div className="sheet-backdrop attach-source-backdrop" onClick={() => setOpen(false)}>
            <div
              className="sheet attach-source-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Add a photo"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" className="attach-source-option" onClick={() => pick(cameraRef)}>
                <Camera />
                Take photo
              </button>
              <button type="button" className="attach-source-option" onClick={() => pick(libraryRef)}>
                <ImagePlus />
                Photo library
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Composer({ workoutOnly }: { workoutOnly: boolean }) {
  return (
    <ComposerPrimitive.Root className="composer">
      <div className="attach-row">
        <ComposerPrimitive.Attachments components={{ Attachment: AttachmentChip }} />
      </div>
      <ComposerPrimitive.Input className="chat-input" placeholder={workoutOnly ? "What are you training today?" : "What are you thinking of eating?"} autoFocus />
      {/* ChatGPT-style controls row under the full-width input: attach
          bottom-left, send/stop bottom-right. */}
      <div className="composer-controls">
        <AttachButton />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="composer-send" aria-label="Send">
            <ArrowUp />
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="composer-send composer-stop" aria-label="Stop">
            <Square fill="currentColor" strokeWidth={0} />
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  );
}

// The live coach thread. Seeded from a saved conversation (or empty for a new
// chat); streams from the coach endpoint, which saves each turn as it runs.
// The parent applies `key={session.key}` so switching threads remounts it.
export function CoachThread({
  initialMessages,
  initialConversationId,
  onPersisted,
  workoutOnly,
  onboarding = false,
  onSkipOnboarding,
}: {
  initialMessages: CoachMessage[];
  initialConversationId: string | null;
  onPersisted: (id: string) => void;
  workoutOnly: boolean;
  /** A new account: open on the setup interview instead of an empty chat. */
  onboarding?: boolean;
  onSkipOnboarding?: () => void;
}) {
  const convIdRef = useRef<string | null>(initialConversationId);
  const onPersistedRef = useRef(onPersisted);
  onPersistedRef.current = onPersisted;

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const history: CoachMessage[] = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            const parts: ({ type: "text"; text: string } | { type: "image"; image: string })[] = [];
            const seenImages = new Set<string>();
            const pushImage = (image: string) => {
              if (seenImages.has(image)) return;
              seenImages.add(image);
              parts.push({ type: "image", image });
            };
            for (const p of m.content) {
              if (p.type === "text" && p.text.trim()) parts.push({ type: "text", text: p.text });
              else if (p.type === "image" && typeof p.image === "string") pushImage(p.image);
            }
            // attachments carry their content parts separately on some paths
            const atts = (m as { attachments?: { content?: { type?: string; image?: string }[] }[] }).attachments ?? [];
            for (const a of atts) for (const p of a.content ?? []) {
              if (p.type === "image" && typeof p.image === "string") pushImage(p.image);
            }
            const hasImage = parts.some((p) => p.type === "image");
            return {
              role: m.role as "user" | "assistant",
              content: hasImage
                ? parts
                : parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n"),
            };
          })
          .filter((m) => (typeof m.content === "string" ? m.content.trim().length > 0 : m.content.length > 0));

        // The worker caps history at 20 messages; send the newest window,
        // opened on a user message, so long conversations keep working.
        let window = history.slice(-20);
        while (window.length && window[0]?.role !== "user") window = window.slice(1);

        let res: Response;
        try {
          res = await api.coachStream(window, todayLocal(), convIdRef.current, abortSignal);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          yield {
            content: [{ type: "text", text: "That message didn't go through, give it another try in a moment." }],
          } as unknown as ChatModelRunResult;
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("coach stream unavailable");
        const decoder = new TextDecoder();

        // Parse the NDJSON event stream into ordered assistant-ui content parts:
        // text parts accumulate; each tool call becomes a "tool-call" part whose
        // result is filled in when it arrives.
        type Part =
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown>; argsText: string; result?: unknown };
        const parts: Part[] = [];
        let cur: { type: "text"; text: string } | null = null;
        const snapshot = (): ChatModelRunResult =>
          ({ content: parts.map((p) => ({ ...p })) }) as unknown as ChatModelRunResult;
        const handle = (line: string) => {
          const s = line.trim();
          if (!s) return;
          let ev: { t: string; v?: string; id?: string; name?: string; args?: unknown; result?: unknown; options?: unknown };
          try {
            ev = JSON.parse(s);
          } catch {
            return;
          }
          if (ev.t === "conversation" && ev.id) {
            convIdRef.current = String(ev.id);
          } else if (ev.t === "text" && ev.v) {
            if (!cur) {
              cur = { type: "text", text: "" };
              parts.push(cur);
            }
            cur.text += ev.v;
          } else if (ev.t === "tool") {
            cur = null;
            parts.push({
              type: "tool-call",
              toolCallId: String(ev.id),
              toolName: String(ev.name),
              args: (ev.args ?? {}) as Record<string, unknown>,
              argsText: JSON.stringify(ev.args ?? {}),
            });
          } else if (ev.t === "result") {
            const p = parts.find((x) => x.type === "tool-call" && x.toolCallId === String(ev.id));
            if (p && p.type === "tool-call") p.result = ev.result;
          } else if (ev.t === "choices" && Array.isArray(ev.options)) {
            // Quick replies ride as a finished offer_choices call (ChoicesTool).
            cur = null;
            parts.push({
              type: "tool-call",
              toolCallId: `choices-${parts.length}`,
              toolName: "offer_choices",
              args: { options: ev.options },
              argsText: JSON.stringify({ options: ev.options }),
              result: "shown",
            });
          } else if (ev.t === "error") {
            // The reply failed partway; say so rather than ending on silence.
            cur = { type: "text", text: String((ev as { message?: unknown }).message ?? "The coach couldn't finish that reply. Please try again.") };
            parts.push(cur);
          }
        };

        // Race every read against the abort signal: iOS Safari does not reject
        // an in-flight reader.read() when the fetch is aborted, which left the
        // stop button dead and the thread stuck in "running" forever.
        const aborted = new Promise<never>((_, reject) => {
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (abortSignal.aborted) fail();
          else abortSignal.addEventListener("abort", fail, { once: true });
        });
        aborted.catch(() => {});
        let buf = "";
        try {
          for (;;) {
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              handle(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
            }
            yield snapshot();
          }
        } finally {
          reader.cancel().catch(() => {});
          // The server has saved the turn (a stopped one too): refresh history.
          if (convIdRef.current) onPersistedRef.current(convIdRef.current);
        }
        if (buf.trim()) handle(buf);
        yield snapshot();
      },
    }),
    [],
  );

  const seeded =
    onboarding && !initialMessages.length
      ? [
          {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: ONBOARDING_GREETING_TEXT },
              {
                type: "tool-call" as const,
                toolCallId: GREETING_CALL_ID,
                toolName: "offer_choices",
                args: { options: ONBOARDING_GOALS },
                argsText: JSON.stringify({ options: ONBOARDING_GOALS }),
                result: "shown",
              },
            ],
          },
        ]
      : initialMessages.map((m) => ({ role: m.role, content: m.content }));
  const runtime = useLocalRuntime(adapter, {
    initialMessages: seeded,
    adapters: { attachments: new SimpleImageAttachmentAdapter() },
  });
  const onboardingCtx = useMemo(() => ({ onSkip: onSkipOnboarding }), [onSkipOnboarding]);

  return (
    <OnboardingContext.Provider value={onboardingCtx}>
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="coach">
        <ThreadPrimitive.Viewport className="chat-list" autoScroll>
          <ThreadPrimitive.Empty>
            <div className="chat-welcome">
              <p className="chat-welcome-title">{workoutOnly ? "Ask before you lift." : "Ask before you eat."}</p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>

          <ThreadPrimitive.ViewportFooter className="chat-input-row">
            <Composer workoutOnly={workoutOnly} />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
    </OnboardingContext.Provider>
  );
}
