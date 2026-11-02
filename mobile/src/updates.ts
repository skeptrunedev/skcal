// Over-the-air updates that land on the next app open, not the next cold start.
//
// expo-updates on its own only checks when the process boots, downloads in the
// background, and applies on the boot after that. iOS keeps apps alive in the
// background for days, so a phone could sit on an old bundle long after an EAS
// Update shipped. This hook closes that gap:
//
//   - every time the app comes to the foreground it checks for and downloads a
//     new update (the boot-time check also feeds the same pending state), and
//   - once an update is downloaded, the next foreground after a real absence
//     reloads into it, at a moment the user has just come back and has nothing
//     on screen worth keeping.
//
// Short trips away (copying a sign-in code from Messages, glancing at another
// app mid-workout) never reload, so in-progress input survives.

import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** How long the app must sit in the background before a pending update applies. */
const MIN_AWAY_MS = 60_000;

async function downloadIfAvailable() {
  const check = await Updates.checkForUpdateAsync();
  if (check.isAvailable) await Updates.fetchUpdateAsync();
}

export function useOtaUpdates() {
  const { isUpdatePending } = Updates.useUpdates();
  const pending = useRef(isUpdatePending);
  pending.current = isUpdatePending;

  useEffect(() => {
    // Dev builds and Expo Go run without expo-updates; nothing to do there.
    if (!Updates.isEnabled) return;

    let backgroundedAt: number | null = null;
    let busy = false;

    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedAt = Date.now();
        return;
      }
      if (next !== "active" || backgroundedAt === null) return;
      const away = Date.now() - backgroundedAt;
      backgroundedAt = null;

      if (pending.current && away >= MIN_AWAY_MS) {
        Updates.reloadAsync().catch((e) => console.warn("update reload failed:", e));
        return;
      }
      if (busy || pending.current) return;
      busy = true;
      downloadIfAvailable()
        .catch((e) => console.warn("update check failed:", e))
        .finally(() => {
          busy = false;
        });
    });
    return () => sub.remove();
  }, []);
}
