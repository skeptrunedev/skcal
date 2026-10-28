// skcal.fit edge worker: serves the Astro landing site from static assets and
// hands /docs* to the skcal-docs worker (the Blume build in ../docs) over a
// service binding, so the docs live at skcal.fit/docs.
type Env = { ASSETS: Fetcher; DOCS: Fetcher };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // docs.skcal.fit is a legacy/convenience hostname: permanently redirect
    // into the canonical /docs subdirectory on the apex.
    if (url.hostname === "docs.skcal.fit") {
      const path = url.pathname === "/" ? "" : url.pathname;
      return Response.redirect(
        `https://skcal.fit/docs${path}${url.search}`,
        301,
      );
    }
    if (url.pathname === "/docs" || url.pathname.startsWith("/docs/")) {
      return env.DOCS.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
