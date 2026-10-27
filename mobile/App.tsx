import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Linking, Alert } from "react-native";
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
  listConversations,
  deleteConversation,
  deleteAccount,
  todayLocal,
  ChatMessage,
  Conversation,
  Dashboard,
  Billing,
} from "./src/api";
import { SignIn } from "./src/SignIn";
import { Today } from "./src/Today";
import { Agent } from "./src/Agent";
import { Train } from "./src/Train";
import { Drawer, DrawerView } from "./src/Drawer";
import { Paywall } from "./src/Paywall";
import { AddSheet } from "./src/AddSheet";
import { McpInstall } from "./src/McpInstall";
import { ApiKeys } from "./src/ApiKeys";
import { LinkedNumbers } from "./src/LinkedNumbers";
import { reconcilePendingTransactions, watchTransactions } from "./src/iap";
import { pickFromLibrary, toUpload } from "./src/image";
import { PanelLeftIcon, PlusIcon } from "./src/icons";

// Content height of the top bar (below the status-bar inset).
const TOPBAR_H = 50;

// The paywall sells through StoreKit, so it only exists on iOS. Android has no
// purchase path until Play Billing ships, and the worker lets Android clients
// through the subscription gate until then (ANDROID_FREE_UNTIL_PLAY_BILLING),
// so Android never shows it.
const HAS_PAYWALL = Platform.OS === "ios";

// Account deletion confirmation. Apple can't be told to cancel an App Store
// subscription on the user's behalf, so iOS says so before the user commits.
const DELETE_ACCOUNT_WARNING =
  "This permanently deletes your account and everything in it: weigh-ins, meals, photos, workouts, reminders, " +
  "and agent history. It can't be undone." +
  (Platform.OS === "ios"
    ? "\n\nIf you subscribed through the App Store, also cancel it in Settings > your name > Subscriptions. " +
      "Deleting your account doesn't stop App Store billing."
    : "");

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
  // Today's latest dashboard (picks the add sheet's first tab) and a counter
  // that tells Today to refetch after the add sheet logs something.
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Set when any API call answers 402. Replaces the whole body with the paywall
  // so no screen can surface a raw "subscription required" string.
  const [blocked, setBlocked] = useState(false);

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
    loadConversations();
  }, [authed, loadConversations]);

  // StoreKit renewals, refunds, and Ask-to-Buy approvals. Anything that lands
  // while the app is open gets pushed to /api/apple/verify immediately rather
  // than waiting on an App Store Server Notification round trip. Also sweeps up
  // transactions that were left unfinished by an earlier failed verify.
  useEffect(() => {
    if (!authed) return;
    reconcilePendingTransactions()
      .then((granted) => {
        if (granted) setBlocked(false);
      })
      .catch(() => {
        /* boot-time reconciliation is best-effort */
      });
    return watchTransactions((result) => {
      if (result.outcome === "active") setBlocked(false);
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
    setDashboard(null);
    setConversations([]);
    setSession({ key: "new-0", convId: null, messages: [] });
    setView("today");
    setBlocked(false);
    setAuthed(false);
  }, []);

  const confirmDeleteAccount = useCallback(() => {
    Alert.alert("Delete your account?", DELETE_ACCOUNT_WARNING, [
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
  }, [signOut]);

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
  const onPersisted = (id: string) => {
    setSession((s) => (s.convId ? s : { ...s, convId: id }));
    loadConversations();
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
        {view === "today" && (
          <Pressable style={s.iconBtn} onPress={() => setAdding(true)} accessibilityLabel="Log entry">
            <PlusIcon size={20} color={c.muted} />
          </Pressable>
        )}
      </View>

      <View style={[s.body, sideInsets]}>
        {blocked ? (
          <Paywall onActivated={() => setBlocked(false)} />
        ) : view === "today" ? (
          <Today
            onAuthError={onAuthError}
            onSubscriptionRequired={HAS_PAYWALL ? () => setBlocked(true) : undefined}
            refreshKey={refreshKey}
            onDashboard={setDashboard}
          />
        ) : view === "train" ? (
          <Train onAuthError={onAuthError} onSubscriptionRequired={HAS_PAYWALL ? () => setBlocked(true) : undefined} />
        ) : (
          <Agent
            key={session.key}
            initialMessages={session.messages}
            initialConversationId={session.convId}
            onPersisted={onPersisted}
            keyboardOffset={Platform.OS === "ios" ? insets.top + TOPBAR_H : 0}
          />
        )}
      </View>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={navigate}
        onAdd={fromDrawer(setAdding)}
        onInstallMcp={fromDrawer(setMcpOpen)}
        account={{
          email,
          avatar,
          uploadingAvatar,
          deleting,
          onPickAvatar: pickAvatar,
          onApiKeys: fromDrawer(setKeysOpen),
          onLinkedNumbers: fromDrawer(setNumbersOpen),
          // App Store subscribers manage their plan with Apple. Android has no
          // purchase path yet, and web (Stripe) billing stays on the web app.
          onBilling:
            Platform.OS === "ios" && billing && !billing.exempt && billing.source === "apple"
              ? () => {
                  setDrawerOpen(false);
                  Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
                }
              : null,
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

      {adding && (
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
