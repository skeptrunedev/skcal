import type {
  DashboardData,
  MesoDetail,
  MesoSummary,
  MuscleFeedback,
  NutritionDay,
  Phase,
  Targets,
  TrainingLibrary,
  TrainingSession,
  TrainingSet,
} from "../shared/types";

function reauth(): never {
  // Cloudflare Access answered a background fetch with a cross-origin login
  // redirect (session expired/logged out). A top-level reload lets Access show
  // its login page in a real navigation instead of a dead "Failed to fetch".
  window.location.reload();
  throw new Error("Session expired — reloading to sign in…");
}

// Use redirect:"manual" so an Access login redirect surfaces as an
// opaqueredirect response we can detect, rather than a thrown CORS error.
export async function rawFetch(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { ...init, redirect: "manual" });
  if (r.type === "opaqueredirect" || r.status === 0) reauth();
  return r;
}

async function jget<T>(url: string): Promise<T> {
  const r = await rawFetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function jsend(url: string, method: string, body: unknown): Promise<void> {
  const r = await rawFetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`);
}

// JSON request that surfaces the server's { error } message on failure.
async function jcall<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await rawFetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `${method} ${url} → ${r.status}`);
  return data;
}

export type PhaseInput = {
  kind?: Phase["kind"];
  startDate?: string;
  plannedEndDate?: string | null;
  goalWeightLb?: number | null;
  ratePctPerWeek?: number | null;
  dailyKcal?: number | null;
  proteinG?: number | null;
  note?: string | null;
};
export type MesoPlanDay = { label?: string; slots: { muscle: string; exerciseId?: string }[] };

export type Reminder = {
  id: string;
  instruction: string;
  time: string; // "HH:MM" local to tz
  days: string; // daily | weekdays | weekends | "mon,wed,fri"
  onceDate: string | null;
  tz: string;
  enabled: boolean;
  nextFireAt: number;
  lastSentAt: number | null;
  createdAt: number;
};

export type MealItem = { name: string; kcal: number; proteinG: number };
export type LoggedItem = MealItem & { id: number };
export type MealAnalysis = {
  ok: true;
  mealId: string;
  items: MealItem[];
  totalKcal: number;
  totalProteinG: number;
  note: string;
  photoKeys: string[];
};
export type Meal = { id: string; note: string | null; createdAt: number; photoKeys: string[]; items: LoggedItem[] };
export type CoachPart = { type: "text"; text: string } | { type: "image"; image: string };
export type CoachMessage = { role: "user" | "assistant"; content: string | CoachPart[] };
export type CoachConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CoachMessage[];
};
export type WeightReading = { id: number; ts: number; weightKg: number; bodyFatPct: number | null; note: string | null; source: string };
export type Workout = {
  id: string;
  source: string;
  activityType: string | null;
  summary: string;
  description: string;
  startedAt: number;
  durationS: number | null;
  distanceM: number | null;
  energyKcal: number | null;
  exercises: { exercise: string; sets: number | null; reps: number | null; weight_lb: number | null; notes: string | null }[];
  createdAt: number;
};
export type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; createdAt: number; lastUsedAt: number | null };
// `source` is which store the reported status came from: an account can hold
// both a Stripe row and an Apple StoreKit row, and `active` is true if either
// grants access.
export type Billing = {
  active: boolean;
  exempt: boolean;
  source: "stripe" | "apple" | null;
  status: string | null;
  periodEnd: number | null;
  priceUsd: number;
};
export type Channel = { id: string; kind: "phone" | "telegram"; value: string; verified: boolean; createdAt: number };

export const api = {
  dashboard: (date: string) => jget<DashboardData>(`/api/dashboard?date=${date}&tz=${new Date().getTimezoneOffset()}`),
  whoami: () => jget<{ email: string }>(`/api/whoami`),
  targets: () => jget<Targets>(`/api/targets`),
  addWeight: (weightKg: number, bodyFatPct?: number | null, note?: string | null) =>
    jsend(`/api/weight`, "POST", { weightKg, bodyFatPct, note }),
  weightList: () => jget<WeightReading[]>(`/api/weight`),
  listReminders: () => jget<{ reminders: Reminder[]; phoneLinked: boolean }>(`/api/reminders`),
  deleteReminder: (id: string) => jsend(`/api/reminders/${id}`, "DELETE", {}),
  setReminderEnabled: (id: string, enabled: boolean) => jsend(`/api/reminders/${id}`, "PATCH", { enabled }),
  setWeightNote: (id: number, note: string | null) => jsend(`/api/weight/${id}`, "PATCH", { note }),
  addMeasurement: (site: string, valueCm: number) =>
    jsend(`/api/measurements`, "POST", { site, valueCm }),
  putNutrition: (d: NutritionDay) => jsend(`/api/nutrition`, "PUT", d),
  analyzeMeal: async (date: string, files: Blob[], note?: string): Promise<MealAnalysis> => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append("photos", f, `meal-${i}.jpg`));
    if (note?.trim()) fd.append("note", note.trim());
    const r = await rawFetch(`/api/nutrition/analyze?date=${date}`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`analyze → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<MealAnalysis>;
  },
  describeMeal: async (date: string, text: string): Promise<MealAnalysis> => {
    const r = await rawFetch(`/api/nutrition/describe?date=${date}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`describe → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<MealAnalysis>;
  },
  coach: async (messages: CoachMessage[], date?: string): Promise<{ reply: string }> => {
    const url = date ? `/api/agent?date=${date}` : `/api/agent`;
    const r = await rawFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, date, tz: new Date().getTimezoneOffset() }),
    });
    if (!r.ok) throw new Error(`coach → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<{ reply: string }>;
  },
  // Streaming variant for the in-app chat: returns the raw Response so the
  // caller can read the NDJSON event stream off `.body`.
  // conversationId (null starts a new one) has the server save the turn.
  coachStream: async (
    messages: CoachMessage[],
    date: string,
    conversationId: string | null,
    signal?: AbortSignal,
  ): Promise<Response> => {
    const r = await rawFetch(`/api/agent/stream?date=${date}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, date, tz: new Date().getTimezoneOffset(), conversationId }),
      signal,
    });
    if (!r.ok) throw new Error(`coach → ${r.status}: ${await r.text().catch(() => "")}`);
    return r;
  },
  // ---- Coach conversation history ----
  listConversations: () => jget<CoachConversation[]>(`/api/agent/conversations`),
  deleteConversation: (id: string) => jsend(`/api/agent/conversations/${id}`, "DELETE", undefined),
  meals: (date: string) => jget<Meal[]>(`/api/nutrition/meals?date=${date}`),
  workouts: (date: string) => jget<Workout[]>(`/api/workouts?date=${date}&tz=${new Date().getTimezoneOffset()}`),
  deleteWorkout: (id: string) => jsend(`/api/workouts/${id}`, "DELETE", undefined),
  deleteMeal: (id: string) => jsend(`/api/nutrition/meals/${id}`, "DELETE", undefined),
  deleteItem: (id: number) => jsend(`/api/nutrition/items/${id}`, "DELETE", undefined),
  photoUrl: (key: string) => `/api/nutrition/photo/${key}`,
  listChannels: () => jget<Channel[]>(`/api/channels`),
  startPhoneLink: (phone: string) => jsend(`/api/channels/phone/start`, "POST", { phone }),
  verifyPhoneLink: async (phone: string, code: string): Promise<Channel> => {
    const r = await rawFetch(`/api/channels/phone/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `verify → ${r.status}`);
    return r.json() as Promise<Channel>;
  },
  deleteChannel: (id: string) => jsend(`/api/channels/${id}`, "DELETE", undefined),
  billing: () => jget<Billing>(`/api/billing`),
  billingCheckout: async (): Promise<{ url: string }> => {
    const r = await rawFetch(`/api/billing/checkout`, { method: "POST" });
    if (!r.ok) throw new Error(`checkout → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<{ url: string }>;
  },
  billingPortal: async (): Promise<{ url: string }> => {
    const r = await rawFetch(`/api/billing/portal`, { method: "POST" });
    if (!r.ok) throw new Error(`portal → ${r.status}`);
    return r.json() as Promise<{ url: string }>;
  },
  listApiKeys: () => jget<ApiKey[]>(`/api/keys`),
  createApiKey: async (name: string, scopes: string[]): Promise<ApiKey & { token: string }> => {
    const r = await rawFetch(`/api/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    if (!r.ok) throw new Error(`createApiKey → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<ApiKey & { token: string }>;
  },
  deleteApiKey: (id: string) => jsend(`/api/keys/${id}`, "DELETE", undefined),
  // ---- goal phases ----
  phases: (date: string) =>
    jget<{ active: Phase | null; phases: Phase[]; maintenance: { kcal: number; days: number } | null }>(`/api/phases?date=${date}`),
  startPhase: (date: string, input: PhaseInput) =>
    jcall<{ ok: true; phase: Phase; kcalSource: "given" | "estimated" | "unchanged"; maintenanceKcal: number | null }>(`/api/phases?date=${date}`, "POST", input),
  updatePhase: (id: string, date: string, input: PhaseInput) => jcall<{ ok: true; phase: Phase }>(`/api/phases/${id}?date=${date}`, "PATCH", input),
  endPhase: (id: string, date: string) => jcall<{ ok: true }>(`/api/phases/${id}/end?date=${date}`, "POST"),
  // ---- training ----
  trainingLibrary: () => jget<TrainingLibrary>(`/api/training/library`),
  mesocycles: () => jget<{ mesocycles: MesoSummary[]; active: MesoSummary | null }>(`/api/training/mesocycles`),
  mesocycle: (id: string) => jget<MesoDetail>(`/api/training/mesocycles/${id}`),
  createMesocycle: (date: string, input: { name?: string; weeks: number; template?: string; days?: MesoPlanDay[]; notes?: string }) =>
    jcall<{ ok: true; mesocycle: MesoDetail }>(`/api/training/mesocycles?date=${date}`, "POST", input),
  updateMesocycle: (id: string, input: { name?: string; notes?: string | null; status?: "completed" | "abandoned" }) =>
    jcall<{ ok: true; mesocycle: MesoDetail }>(`/api/training/mesocycles/${id}`, "PATCH", input),
  deleteMesocycle: (id: string) => jcall<{ ok: true }>(`/api/training/mesocycles/${id}`, "DELETE"),
  currentSession: () => jget<{ active: false } | { active: true; session: TrainingSession }>(`/api/training/current`),
  session: (mesoId: string, week: number, day: number) => jget<TrainingSession>(`/api/training/mesocycles/${mesoId}/sessions/${week}/${day}`),
  completeSession: (mesoId: string, week: number, day: number) =>
    jcall<{ ok: true; next: { week: number; day: number; label: string | null } | null; mesoCompleted: boolean }>(
      `/api/training/mesocycles/${mesoId}/sessions/${week}/${day}/complete`,
      "POST",
    ),
  setFeedback: (mesoId: string, input: Partial<MuscleFeedback> & { week: number; day: number; muscle: string }) =>
    jcall<{ ok: true }>(`/api/training/mesocycles/${mesoId}/feedback`, "PUT", input),
  updateSet: (id: string, patch: { weightLb?: number | null; reps?: number | null; done?: boolean }) =>
    jcall<{ ok: true; set: TrainingSet }>(`/api/training/sets/${id}`, "PATCH", patch),
  deleteSet: (id: string) => jcall<{ ok: true }>(`/api/training/sets/${id}`, "DELETE"),
  addSet: (slotId: string, week: number) => jcall<{ ok: true; set: TrainingSet }>(`/api/training/slots/${slotId}/sets`, "POST", { week }),
  swapExercise: (slotId: string, exerciseId: string, fromWeek: number) =>
    jcall<{ ok: true }>(`/api/training/slots/${slotId}`, "PATCH", { exerciseId, fromWeek }),
  setAvatar: async (file: Blob): Promise<{ image: string }> => {
    const fd = new FormData();
    fd.append("photo", file, "avatar.jpg");
    const r = await rawFetch(`/api/profile/avatar`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`avatar → ${r.status}`);
    return r.json() as Promise<{ image: string }>;
  },
};

export const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
