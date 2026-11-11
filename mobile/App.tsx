import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Linking, Alert, KeyboardAvoidingView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme, ThemeProvider, type Palette } from "./src/theme";
import {
  getToken,
  setToken,
  whoami,
  profileImage,
  setAvatar,
  billing as fetchBilling,
  getSettings,
  updateSettings,
  listConversations,
  deleteConversation,
  deleteAccount,
  todayLocal,
  ChatMessage,
  Conversation,
  Dashboard,
  Billing,
  AppMode,
} from "./src/api";
import { SignIn } from "./src/SignIn";
import { Today } from "./src/Today";
import { Agent } from "./src/Agent";
import { Train } from "./src/Train";
import { Drawer, DrawerView } from "./src/Drawer";
import { AddSheet } from "./src/AddSheet";
import { McpInstall } from "./src/McpInstall";
import { ApiKeys } from "./src/ApiKeys";
import { LinkedNumbers } from "./src/LinkedNumbers";
import { reconcilePendingTransactions, watchTransactions } from "./src/iap";
import { pickFromLibrary, toUpload } from "./src/image";
import { useOtaUpdates } from "./src/updates";
import { PanelLeftIcon, PlusIcon } from "./src/icons";

// Content height of the top bar (below the status-bar inset).
const TOPBAR_H = 50;

// Account deletion confirmation. Apple can't be told to cancel an App Store
// subscription on the user's behalf, so an account still paying Apple from
// before skcal went free is told so before it commits.
const DELETE_ACCOUNT_WARNING =
  "This permanently deletes your account and everything in it: weigh-ins, meals, photos, workouts, reminders, " +
  "and agent history. It can't be undone.";
const APPLE_SUBSCRIPTION_WARNING =
  "\n\nYour App Store subscription keeps billing until you cancel it in Settings > your name > Subscriptions. " +
  "Deleting your account doesn't stop it.";

type Session = { key: string; convId: string | null; messages: ChatMessage[] };

const TITLES: Record<DrawerView, string> = { today: "Today", train: "Train", coach: "Agent" };

// Where an App Store subscriber manages or cancels their plan.
const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

// True when the most recent weigh-in falls on today (local date). The trend is
// raw readings in ascending time order, so the last point is the latest.
function weightLoggedToday(data: Dashboard | null): boolean {
  const last = data?.weight.trend.at(-1);
  if (!last) return false;
  return new Date(last.ts).toLocaleDateString("en-CA") === todayLocal();
}

function Shell() {
  const s = useS();
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<DrawerView>("today");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [avatar, setAvatarImage] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [billing, setBilling] = useState<Billing | null>(null);
  // Account-wide app mode, shared with the web app. "workout" strips calories,
  // food, the scale, and weigh-ins out of every screen.
  const [mode, setMode] = useState<AppMode>("full");
  const workoutOnly = mode === "workout";
  // False for a new account: the app opens on the agent's setup interview.
  // Null until settings load.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // Today's latest dashboard (picks the add sheet's first tab) and a counter
  // that tells Today to refetch after the add sheet logs something.
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Agent conversation history — lives up here (like the web app) so the
  // drawer and the chat view share one state.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const nonce = useRef(0);
  const [session, setSession] = useState<Session>({ key: "new-0", convId: null, messages: [] });

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      /* history is best-effort */
    }
  }, []);

  useEffect(() => {
    // Never leave the app on a blank boot screen: if secure storage throws
    // (locked keychain, unsigned build), fall through to sign-in instead.
    getToken()
      .then((t) => setAuthed(!!t))
      .catch((e) => console.warn("token read failed, showing sign in:", e))
      .finally(() => setReady(true));
  }, []);

  // Deep-link session injection: `skcal://session?token=…` stores the token and
  // marks us signed in. Possessing a valid session token IS authentication, so
  // this opens no new hole — it exists so a headless simulator (which can't type
  // into the sign-in field) can be driven straight to the logged-in app.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const m = url.match(/[?&]token=([^&]+)/);
      if (url.includes("session") && m) {
        setToken(decodeURIComponent(m[1])).then(() => setAuthed(true));
      }
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!authed) return;
    whoami().then((w) => setEmail(w.email)).catch(() => {});
    profileImage().then(setAvatarImage).catch(() => {});
    fetchBilling().then(setBilling).catch(() => {});
    getSettings()
      .then((st) => {
        setMode(st.mode);
        setOnboarded(st.onboarded);
        if (!st.onboarded) setView("coach");
      })
      .catch(() => {});
    loadConversations();
  }, [authed, loadConversations]);

  // StoreKit renewals, refunds, and revocations on an App Store subscription
  // bought before skcal went free. Anything that lands while the app is open
  // goes to /api/apple/verify immediately rather than waiting on an App Store
  // Server Notification round trip, then the Billing item is refetched. Also
  // sweeps up transactions an earlier failed verify left unfinished.
  useEffect(() => {
    if (!authed) return;
    reconcilePendingTransactions().catch(() => {
      /* boot-time reconciliation is best-effort */
    });
    return watchTransactions(() => {
      fetchBilling().then(setBilling).catch(() => {});
    });
  }, [authed]);

  // Android back: close the drawer, then step back from Train or Agent to
  // Today, before leaving the app. (Sheets close themselves via Modal.)
  useEffect(() => {
    if (!drawerOpen && view === "today") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) setDrawerOpen(false);
      else setView("today");
      return true;
    });
    return () => sub.remove();
  }, [drawerOpen, view]);

  const signOut = useCallback(async () => {
    setDrawerOpen(false);
    await setToken(null);
    setEmail(null);
    setAvatarImage(null);
    setBilling(null);
    setMode("full");
    setOnboarded(null);
    setDashboard(null);
    setConversations([]);
    setSession({ key: "new-0", convId: null, messages: [] });
    setView("today");
    setAuthed(false);
  }, []);

  const confirmDeleteAccount = useCallback(() => {
    const warning = DELETE_ACCOUNT_WARNING + (billing?.source === "apple" ? APPLE_SUBSCRIPTION_WARNING : "");
    Alert.alert("Delete your account?", warning, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount();
          } catch (e) {
            setDeleting(false);
            Alert.alert("Couldn’t delete your account", e instanceof Error ? e.message : String(e));
            return;
          }
          setDeleting(false);
          await signOut();
        },
      },
    ]);
  }, [signOut, billing]);

  // Optimistic: flip the UI now, adopt what the server stored, and fall back
  // to the previous mode if the save fails.
  const changeMode = (next: AppMode) => {
    const prev = mode;
    setMode(next);
    updateSettings({ mode: next })
      .then((st) => setMode(st.mode))
      .catch((e) => {
        setMode(prev);
        Alert.alert("Couldn’t change the app mode", e instanceof Error ? e.message : String(e));
      });
  };

  const navigate = (v: DrawerView) => {
    setDrawerOpen(false);
    setView(v);
  };
  // Drawer actions that open a sheet close the drawer first, as on the web.
  const fromDrawer = (open: (v: boolean) => void) => () => {
    setDrawerOpen(false);
    open(true);
  };
  const pickAvatar = async () => {
    const [asset] = await pickFromLibrary(false);
    if (!asset) return;
    setUploadingAvatar(true);
    try {
      setAvatarImage((await setAvatar(toUpload(asset))).image);
    } catch {
      // keep the current avatar
    } finally {
      setUploadingAvatar(false);
    }
  };
  const newChat = () => {
    nonce.current += 1;
    setSession({ key: `new-${nonce.current}`, convId: null, messages: [] });
    navigate("coach");
  };
  const openConversation = (c: Conversation) => {
    setSession({ key: c.id, convId: c.id, messages: c.messages });
    navigate("coach");
  };
  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
    } catch {
      /* ignore */
    }
    if (session.convId === id) {
      nonce.current += 1;
      setSession({ key: `new-${nonce.current}`, convId: null, messages: [] });
    }
    loadConversations();
  };
  // First turn persisted server-side: adopt the id and refresh the list.
  // During setup, re-read settings: the agent finishes onboarding (and may
  // switch the app to workouts only) from inside the conversation.
  const onPersisted = (id: string) => {
    setSession((s) => (s.convId ? s : { ...s, convId: id }));
    loadConversations();
    if (onboarded === false)
      getSettings()
        .then((st) => {
          setMode(st.mode);
          setOnboarded(st.onboarded);
        })
        .catch(() => {});
  };
  const skipOnboarding = () => {
    setOnboarded(true);
    setView("today");
    updateSettings({ onboarded: true }).catch(() => {});
  };

  // Light content on the dark theme, dark content on the light one.
  const statusBar = <StatusBar style={scheme === "dark" ? "light" : "dark"} />;
  // Every system bar and cutout is padded off: in landscape the nav bar or
  // camera cutout sits on a side, so left/right matter as much as top/bottom.
  const sideInsets = { paddingLeft: insets.left, paddingRight: insets.right };

  if (!ready) return <View style={s.boot}>{statusBar}</View>;
  if (!authed)
    return (
      <View style={[s.boot, sideInsets, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {statusBar}
        <SignIn onSignedIn={() => setAuthed(true)} />
      </View>
    );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q)),
      )
    : conversations;

  const onAuthError = async () => {
    await setToken(null);
    setAuthed(false);
  };

  return (
    <View style={s.root}>
      {statusBar}

      <View style={[s.topbar, { paddingTop: insets.top, paddingLeft: 10 + insets.left, paddingRight: 10 + insets.right }]}>
        <Pressable style={s.iconBtn} onPress={() => setDrawerOpen(true)} accessibilityLabel="Menu">
          <PanelLeftIcon size={20} color={c.muted} />
        </Pressable>
        <Text style={s.topbarTitle}>{TITLES[view]}</Text>
        {view === "today" && !workoutOnly && (
          <Pressable style={s.iconBtn} onPress={() => setAdding(true)} accessibilityLabel="Log entry">
            <PlusIcon size={20} color={c.muted} />
          </Pressable>
        )}
      </View>

      {/* Every screen sits above the keyboard. Edge-to-edge Android never
          resizes the window for it, so without this the keyboard covers the
          agent's composer and any field low in Today's or Train's scroll view.
          KeyboardAvoidingView compares its parent-relative frame with the
          keyboard's screen Y; root fills the screen from y=0, so that frame
          already includes the status bar and topbar and needs no offset. */}
      <KeyboardAvoidingView style={[s.body, sideInsets]} behavior="padding">
        {view === "today" ? (
          <Today
            onAuthError={onAuthError}
            refreshKey={refreshKey}
            onDashboard={setDashboard}
            workoutOnly={workoutOnly}
          />
        ) : view === "train" ? (
          <Train onAuthError={onAuthError} />
        ) : (
          <Agent
            key={session.key}
            initialMessages={session.messages}
            initialConversationId={session.convId}
            onPersisted={onPersisted}
            workoutOnly={workoutOnly}
            onboarding={onboarded === false}
            onSkipOnboarding={skipOnboarding}
          />
        )}
      </KeyboardAvoidingView>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={navigate}
        onAdd={workoutOnly ? null : fromDrawer(setAdding)}
        onInstallMcp={fromDrawer(setMcpOpen)}
        account={{
          email,
          avatar,
          uploadingAvatar,
          deleting,
          onPickAvatar: pickAvatar,
          onApiKeys: fromDrawer(setKeysOpen),
          onLinkedNumbers: fromDrawer(setNumbersOpen),
          // Only a live App Store subscription from before skcal went free has
          // anything to manage here; Stripe ones are managed on the web app.
          onBilling:
            Platform.OS === "ios" && billing?.source === "apple"
              ? () => {
                  setDrawerOpen(false);
                  Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
                }
              : null,
          mode,
          onModeChange: changeMode,
          onSignOut: signOut,
          onDeleteAccount: confirmDeleteAccount,
        }}
        conversations={filtered}
        activeId={session.convId}
        search={search}
        onSearch={setSearch}
        onNewChat={newChat}
        onOpenConversation={openConversation}
        onDeleteConversation={removeConversation}
      />

      {adding && !workoutOnly && (
        <AddSheet
          open
          onClose={() => setAdding(false)}
          onChange={() => setRefreshKey((k) => k + 1)}
          // If today's weigh-in is already logged, open straight to nutrition.
          defaultTab={weightLoggedToday(dashboard) ? "nutrition" : "weight"}
        />
      )}
      <McpInstall open={mcpOpen} onClose={() => setMcpOpen(false)} />
      <ApiKeys open={keysOpen} onClose={() => setKeysOpen(false)} />
      <LinkedNumbers open={numbersOpen} onClose={() => setNumbersOpen(false)} />
    </View>
  );
}

export default function App() {
  useOtaUpdates();
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const useS = makeStyles((C: Palette) =>
  StyleSheet.create({
  boot: { flex: 1, backgroundColor: C.bg },
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.bg,
  },
  iconBtn: { width: 38, height: TOPBAR_H, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  topbarTitle: { flex: 1, color: C.fg, fontSize: 15.5, fontWeight: "600" },
  // Full window width in every orientation; screens lay out one or two
  // columns from the width they get (src/layout.ts).
  body: { flex: 1 },
  }),
);
