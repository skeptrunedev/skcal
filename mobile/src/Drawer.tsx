import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Animated, Easing, Alert, AccessibilityInfo, Platform, useWindowDimensions, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme, type ThemePref } from "./theme";
import { Conversation, photoSource } from "./api";
import {
  SunIcon, MessageSquareIcon, SquarePenIcon, SearchIcon, TrashIcon, DumbbellIcon, PlusIcon, PlugIcon, ChevronDownIcon,
  PanelLeftIcon, BrandMark,
} from "./icons";

export type DrawerView = "today" | "train" | "coach";

const THEME_OPTIONS: { pref: ThemePref; label: string }[] = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

/** The profile menu's account actions; a null action hides its item. */
export type AccountActions = {
  email: string | null;
  avatar: string | null;
  uploadingAvatar: boolean;
  deleting: boolean;
  onPickAvatar: () => void;
  onApiKeys: () => void;
  onLinkedNumbers: () => void;
  onBilling: (() => void) | null;
  onSignOut: () => void;
  onDeleteAccount: () => void;
};

// "3m" / "2h" / "5d" ago, matching a compact recents list.
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(ts).toLocaleDateString();
}

function NavItem({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active?: boolean; onPress: () => void }) {
  const s = useS();
  return (
    <Pressable style={[s.navItem, active && s.navItemActive]} onPress={onPress} accessibilityRole="button">
      <View style={s.navItemIcon}>{icon}</View>
      <Text style={s.navItemLabel}>{label}</Text>
    </Pressable>
  );
}

// Left slide-in drawer over a dim scrim — the mobile web app's NavDrawer:
// brand header, nav links, the agent history (new chat / search / recents),
// and the profile row pinned to the bottom with its account menu.
export function Drawer({
  open,
  onClose,
  view,
  onNavigate,
  onAdd,
  onInstallMcp,
  account,
  conversations,
  activeId,
  search,
  onSearch,
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
}: {
  open: boolean;
  onClose: () => void;
  view: DrawerView;
  onNavigate: (v: DrawerView) => void;
  onAdd: () => void;
  onInstallMcp: () => void;
  account: AccountActions;
  conversations: Conversation[];
  activeId: string | null;
  search: string;
  onSearch: (q: string) => void;
  onNewChat: () => void;
  onOpenConversation: (c: Conversation) => void;
  onDeleteConversation: (id: string) => void;
}) {
  const s = useS();
  const { c, pref, setPref } = useTheme();
  const insets = useSafeAreaInsets();
  const [profileMenu, setProfileMenu] = useState(false);
  // Recomputed on rotation; the left inset (cutout or side nav bar in
  // landscape) is padded inside the panel so its contents stay clear of it.
  const { width } = useWindowDimensions();
  const DRAWER_W = Math.min(width * 0.84, 320) + insets.left;
  const progress = useRef(new Animated.Value(0)).current;
  // Keep mounted through the slide-out so the close animation plays.
  const [shown, setShown] = useState(open);
  const reduceMotion = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion.current = v)).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) setShown(true);
    else setProfileMenu(false);
    const anim = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduceMotion.current ? 0 : 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => anim.stop();
  }, [open, progress]);

  if (!shown) return null;

  const confirmDelete = (conv: Conversation) =>
    Alert.alert("Delete conversation?", conv.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDeleteConversation(conv.id) },
    ]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[s.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        style={[
          s.drawer,
          {
            width: DRAWER_W,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            paddingLeft: insets.left + 10,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-DRAWER_W, 0] }) }],
          },
        ]}
      >
        <View style={s.head}>
          <View style={s.brandRow}>
            <BrandMark size={22} />
            <Text style={s.brand}>skcal</Text>
          </View>
          <Pressable style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu">
            <PanelLeftIcon size={19} color={c.muted} />
          </Pressable>
        </View>

        <NavItem
          icon={<SunIcon size={19} color={view === "today" ? c.amberText : c.muted} />}
          label="Today"
          active={view === "today"}
          onPress={() => onNavigate("today")}
        />
        <NavItem
          icon={<DumbbellIcon size={19} color={view === "train" ? c.amberText : c.muted} />}
          label="Train"
          active={view === "train"}
          onPress={() => onNavigate("train")}
        />
        <NavItem
          icon={<MessageSquareIcon size={19} color={view === "coach" ? c.amberText : c.muted} />}
          label="Agent"
          active={view === "coach"}
          onPress={() => onNavigate("coach")}
        />
        <NavItem icon={<PlusIcon size={19} color={c.muted} />} label="Log entry" onPress={onAdd} />
        <NavItem icon={<PlugIcon size={19} color={c.muted} />} label="Install MCP" onPress={onInstallMcp} />

        <View style={s.divider} />

        <NavItem icon={<SquarePenIcon size={19} color={c.muted} />} label="New chat" onPress={onNewChat} />
        <View style={s.searchWrap}>
          <View style={s.searchIcon}>
            <SearchIcon size={15} color={c.muted} />
          </View>
          <TextInput
            style={[s.search, Platform.OS === "web" && WEB_NO_RING]}
            placeholder="Search chats"
            placeholderTextColor={c.muted}
            value={search}
            onChangeText={onSearch}
          />
        </View>
        <Text style={s.recentsLabel}>RECENTS</Text>
        <ScrollView style={s.recents} contentContainerStyle={s.recentsContent}>
          {conversations.length === 0 && (
            <Text style={s.empty}>{search.trim() ? "No matches" : "No conversations yet"}</Text>
          )}
          {conversations.map((conv) => (
            <View key={conv.id} style={[s.recent, activeId === conv.id && s.recentActive]}>
              <Pressable
                style={s.recentBtn}
                onPress={() => onOpenConversation(conv)}
                onLongPress={() => confirmDelete(conv)}
              >
                <Text style={s.recentTitle} numberOfLines={1}>{conv.title}</Text>
                <Text style={s.recentTime}>{relTime(conv.updatedAt)}</Text>
              </Pressable>
              <Pressable style={s.recentDel} onPress={() => confirmDelete(conv)} accessibilityLabel="Delete conversation">
                <TrashIcon size={15} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <View style={s.foot}>
          {profileMenu && (
            <View style={s.menu} accessibilityRole="menu">
              <MenuItem
                label={account.uploadingAvatar ? "Uploading…" : account.avatar ? "Change photo" : "Add photo"}
                disabled={account.uploadingAvatar}
                onPress={account.onPickAvatar}
              />
              <MenuItem label="API keys" onPress={() => { setProfileMenu(false); account.onApiKeys(); }} />
              <MenuItem label="Linked numbers" onPress={() => { setProfileMenu(false); account.onLinkedNumbers(); }} />
              {account.onBilling && (
                <MenuItem label="Billing" onPress={() => { setProfileMenu(false); account.onBilling?.(); }} />
              )}
              <Text style={s.menuSection}>APPEARANCE</Text>
              <View style={s.segment} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
                {THEME_OPTIONS.map((o) => (
                  <Pressable
                    key={o.pref}
                    style={[s.segmentItem, pref === o.pref && s.segmentItemOn]}
                    onPress={() => setPref(o.pref)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: pref === o.pref }}
                    accessibilityLabel={`${o.label} appearance`}
                  >
                    <Text style={[s.segmentText, pref === o.pref && s.segmentTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={s.menuDivider} />
              <MenuItem label="Sign out" onPress={() => { setProfileMenu(false); account.onSignOut(); }} />
              <MenuItem
                label={account.deleting ? "Deleting…" : "Delete account"}
                danger
                disabled={account.deleting}
                onPress={account.onDeleteAccount}
              />
            </View>
          )}
          <Pressable
            style={s.profileRow}
            onPress={() => setProfileMenu((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Account"
            accessibilityState={{ expanded: profileMenu }}
          >
            <View style={s.avatar}>
              {account.avatar ? (
                <Image source={photoSource(account.avatar)} style={s.avatarImg} />
              ) : (
                <Text style={s.avatarText}>{account.email?.[0]?.toUpperCase() ?? "·"}</Text>
              )}
            </View>
            <Text style={s.profileEmail} numberOfLines={1}>{account.email ?? "…"}</Text>
            <ChevronDownIcon size={16} color={c.muted} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function MenuItem({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const s = useS();
  return (
    <Pressable style={s.menuItem} onPress={onPress} disabled={disabled} accessibilityRole="menuitem">
      <Text style={[s.menuItemText, danger && s.menuItemDanger]}>{label}</Text>
    </Pressable>
  );
}

// RNW draws a UA focus ring the border already replaces.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

const useS = makeStyles((c) =>
  StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim },
  drawer: {
    position: "absolute", top: 0, bottom: 0, left: 0,
    backgroundColor: c.bg, paddingHorizontal: 10,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.line,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 8, paddingVertical: 4 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  close: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  brand: { color: c.fg, fontFamily: "monospace", letterSpacing: 3, fontSize: 14, fontWeight: "700" },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 9 },
  navItemActive: { backgroundColor: c.selected },
  navItemIcon: { width: 20, alignItems: "center" },
  navItemLabel: { color: c.fg, fontSize: 15 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 8, marginHorizontal: 3 },
  searchWrap: { position: "relative", justifyContent: "center", marginTop: 2 },
  searchIcon: { position: "absolute", left: 11, zIndex: 1 },
  search: {
    backgroundColor: c.field, borderWidth: 1, borderColor: c.line, borderRadius: 10,
    color: c.fg, fontSize: 14.5, paddingVertical: 8, paddingLeft: 34, paddingRight: 12,
  },
  recentsLabel: { color: c.muted, fontFamily: "monospace", fontSize: 10, letterSpacing: 1, marginTop: 12, marginBottom: 2, paddingHorizontal: 4 },
  recents: { flex: 1 },
  recentsContent: { gap: 1 },
  empty: { color: c.muted, fontSize: 13, padding: 6 },
  recent: { flexDirection: "row", alignItems: "center", borderRadius: 8 },
  recentActive: { backgroundColor: c.selected },
  recentBtn: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 8 },
  recentTitle: { flex: 1, color: c.fg, fontSize: 14 },
  recentTime: { color: c.muted, fontFamily: "monospace", fontSize: 11 },
  recentDel: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  foot: { position: "relative", paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 9, padding: 8, borderRadius: 10 },
  avatar: {
    width: 30, height: 30, borderRadius: 15, overflow: "hidden",
    borderWidth: 1, borderColor: c.line, backgroundColor: c.raised,
    alignItems: "center", justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { color: c.muted, fontFamily: "monospace", fontSize: 12, fontWeight: "600" },
  profileEmail: { flex: 1, minWidth: 0, color: c.muted, fontSize: 13 },
  menu: {
    position: "absolute", left: 3, right: 3, bottom: "100%", marginBottom: 4,
    backgroundColor: c.raised, borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 5,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 9, borderRadius: 8 },
  menuItemText: { color: c.fg, fontSize: 14.5 },
  menuItemDanger: { color: c.error },
  menuSection: { color: c.muted, fontFamily: "monospace", fontSize: 10, letterSpacing: 1, paddingHorizontal: 9, paddingTop: 8, paddingBottom: 6 },
  segment: { flexDirection: "row", marginHorizontal: 6, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 2, gap: 2 },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8 },
  segmentItemOn: { backgroundColor: c.amber },
  segmentText: { color: c.fg, fontSize: 13 },
  segmentTextOn: { color: c.amberInk, fontWeight: "700" },
  menuDivider: { height: 1, backgroundColor: c.line, marginVertical: 6, marginHorizontal: 3 },
  }),
);
