// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const https = require("https");

// SKCAL_API_ORIGIN points the preview at another worker, e.g. the local
// `npm run dev` one (http://localhost:5173) to compare against the web app on
// the same local data.
const API_ORIGIN = new URL(process.env.SKCAL_API_ORIGIN || "https://app.skcal.fit");
const API = API_ORIGIN.host;
const transport = API_ORIGIN.protocol === "http:" ? http : https;

const config = getDefaultConfig(__dirname);

// Expo-web preview only: the worker sends no CORS headers, so the web build
// calls /api on its own origin (see BASE in src/api.ts) and the dev server
// forwards those requests to production (or SKCAL_API_ORIGIN). Origin is rewritten so Better Auth
// treats the sign-in as same-site. Native builds never hit this.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url.startsWith("/api/")) return middleware(req, res, next);
    const headers = { ...req.headers, host: API };
    if (headers.origin) headers.origin = API_ORIGIN.origin;
    delete headers.referer;
    const upstream = transport.request({ host: API_ORIGIN.hostname, port: API_ORIGIN.port || undefined, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `preview proxy: ${e.message}` }));
    });
    req.pipe(upstream);
  },
};

module.exports = config;
