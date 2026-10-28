import { defineConfig } from "blume";
import { openapi } from "blume/reference";

export default defineConfig({
  title: "skcal",
  description: "The AI-native way to manage your health: nutrition, body weight, and training in one account you can drive from an app, an agent, or code.",
  // The amber mark (same file as the site's nav) beside the "skcal" title.
  logo: "/logo/mark.svg",
  theme: { accent: { light: "#f59e0b", dark: "#fbbf24" }, action: "#d97706" },
  content: { root: "content" },
  // The worker's generated spec (npm run openapi:gen at the repo root), read in
  // place so the reference can't drift from a copy.
  reference: [openapi({ spec: "../src/worker/openapi.gen.json", route: "/api-reference" })],
  navigation: {
    tabs: [
      { label: "Documentation", path: "/" },
      { label: "API reference", path: "/api-reference" },
    ],
    cta: { label: "Open skcal", href: "https://app.skcal.fit" },
    repo: false,
  },
  footer: {
    links: [
      { label: "App", href: "https://app.skcal.fit" },
      { label: "iPhone", href: "https://apps.apple.com/us/app/skcal/id6789390978" },
      { label: "Android", href: "https://play.google.com/store/apps/details?id=fit.skcal.app" },
      { label: "Privacy", href: "https://skcal.fit/privacy" },
      { label: "Terms", href: "https://skcal.fit/terms" },
    ],
  },
  // Mintlify slugged endpoint pages by summary; Blume slugs them by
  // operationId. Keep the old URLs working.
  redirects: [
    { from: "/api-reference/coach/ask-the-ai-coach", to: "/api-reference/coach/coach", status: 308 },
    { from: "/api-reference/dashboard/home-screen-snapshot", to: "/api-reference/dashboard/get-dashboard", status: 308 },
    { from: "/api-reference/ingest/ingest-a-scale-reading", to: "/api-reference/ingest/ingest-weight", status: 308 },
    { from: "/api-reference/measurements/record-a-measurement", to: "/api-reference/measurements/add-measurement", status: 308 },
    { from: "/api-reference/nutrition/delete-a-food-item", to: "/api-reference/nutrition/delete-item", status: 308 },
    { from: "/api-reference/nutrition/delete-a-meal", to: "/api-reference/nutrition/delete-meal", status: 308 },
    { from: "/api-reference/nutrition/fetch-a-meal-photo", to: "/api-reference/nutrition/get-meal-photo", status: 308 },
    { from: "/api-reference/nutrition/list-daily-totals", to: "/api-reference/nutrition/list-nutrition-days", status: 308 },
    { from: "/api-reference/nutrition/list-meals-for-a-day", to: "/api-reference/nutrition/list-meals", status: 308 },
    { from: "/api-reference/nutrition/log-a-meal-from-a-description", to: "/api-reference/nutrition/describe-meal", status: 308 },
    { from: "/api-reference/nutrition/log-a-meal-from-photos", to: "/api-reference/nutrition/analyze-meal", status: 308 },
    { from: "/api-reference/nutrition/log-a-meal-or-workout-from-photos", to: "/api-reference/nutrition/analyze-any", status: 308 },
    { from: "/api-reference/nutrition/upsert-a-days-totals", to: "/api-reference/nutrition/upsert-nutrition-day", status: 308 },
    { from: "/api-reference/service/liveness-probe", to: "/api-reference/service/get-health", status: 308 },
    { from: "/api-reference/service/resolve-the-current-identity", to: "/api-reference/service/whoami", status: 308 },
    { from: "/api-reference/spec/openapi-document", to: "/api-reference/spec/get-openapi", status: 308 },
    { from: "/api-reference/targets/get-goals", to: "/api-reference/targets/get-targets", status: 308 },
    { from: "/api-reference/targets/update-goals", to: "/api-reference/targets/update-targets", status: 308 },
    { from: "/api-reference/weight/edit-a-weigh-in-note", to: "/api-reference/weight/update-weight-note", status: 308 },
    { from: "/api-reference/weight/list-weigh-ins", to: "/api-reference/weight/list-weight", status: 308 },
    { from: "/api-reference/weight/log-a-weigh-in", to: "/api-reference/weight/add-weight", status: 308 },
    { from: "/api-reference/workouts/delete-a-workout", to: "/api-reference/workouts/delete-workout", status: 308 },
    { from: "/api-reference/workouts/list-a-days-workouts", to: "/api-reference/workouts/list-workouts", status: 308 },
    { from: "/api-reference/workouts/log-a-workout-from-a-description", to: "/api-reference/workouts/describe-workout", status: 308 },
  ],
  // Served at skcal.fit/docs: the skcal.fit worker forwards /docs* to the
  // skcal-docs worker over a service binding.
  deployment: { site: "https://skcal.fit", base: "/docs" },
});
