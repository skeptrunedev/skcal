import type { Palette } from "./theme";
import { kgToLb, type Phase } from "./api";

const DAY = 86_400_000;

// Week-over-week change and the status pill, the same rules as the web
// dashboard's weight hero (src/client/Dashboard.tsx).
export function weeklyDeltaLb(trend: { ts: number; kg: number }[]): number | null {
  if (trend.length < 2) return null;
  const cut = trend[trend.length - 1].ts - 7 * DAY;
  const win = trend.filter((p) => p.ts >= cut);
  const series = win.length >= 2 ? win : trend;
  return kgToLb(series[series.length - 1].kg) - kgToLb(series[0].kg);
}

// The week's direction read against the goal phase: down is on track in a
// cut (or with no phase, the default lean cut), up is on track in a bulk.
export function weightInsight(
  latestLb: number | null,
  delta: number | null,
  c: Palette,
  kind: Phase["kind"] | null = null,
): { head: string; status: { label: string; color: string } | null } {
  if (latestLb == null) return { head: "Log your first weigh-in", status: null };
  if (delta == null) return { head: "Tracking started — keep logging", status: { label: "NEW", color: c.info } };
  const want = kind === "bulk" ? 1 : kind === "maintain" ? 0 : -1;
  const dir = delta < -0.1 ? -1 : delta > 0.1 ? 1 : 0;
  const head = dir < 0 ? `Down ${Math.abs(delta).toFixed(1)} lb this week` : dir > 0 ? `Up ${delta.toFixed(1)} lb this week` : "Holding steady this week";
  if (dir === 0) return { head, status: { label: "STEADY", color: c.info } };
  return { head, status: dir === want ? { label: "ON TRACK", color: c.amberText } : { label: "WATCH TREND", color: c.attention } };
}
