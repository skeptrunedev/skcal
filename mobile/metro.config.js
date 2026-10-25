// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const https = require("https");

const API = "app.skcal.fit";

const config = getDefaultConfig(__dirname);

// Expo-web preview only: the worker sends no CORS headers, so the web build
// calls /api on its own origin (see BASE in src/api.ts) and the dev server
// forwards those requests to production. Origin is rewritten so Better Auth
// treats the sign-in as same-site. Native builds never hit this.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url.startsWith("/api/")) return middleware(req, res, next);
    const headers = { ...req.headers, host: API };
    if (headers.origin) headers.origin = `https://${API}`;
    delete headers.referer;
    const upstream = https.request({ host: API, path: req.url, method: req.method, headers }, (r) => {
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
