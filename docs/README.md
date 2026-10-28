# skcal docs

The docs site at [skcal.fit/docs](https://skcal.fit/docs), built with
[Blume](https://useblume.dev): guides, CLI and MCP install, and an API reference
generated from the worker's OpenAPI spec.

## Develop

```bash
cd docs
bun install          # npm install hangs resolving Blume's tree; bun.lock is the lockfile
bun run dev          # or `npm run docs:dev` from the repo root
```

Pages live in `content/`. Folders in parentheses, like `(get-started)/`, are
sidebar groups that add no URL segment; each has a `meta.ts` for its label and
order.

## API reference

Blume reads `../src/worker/openapi.gen.json` directly, so the reference always
matches the worker. Regenerate the spec with `npm run openapi:gen` from the repo
root after changing a route's `@openapi` block.

## Deploy

```bash
bun run validate     # links, anchors, assets
bun run deploy       # blume build, stage, wrangler deploy (the skcal-docs worker)
```

`skcal-docs` has no route of its own. The skcal.fit worker in `site/` forwards
`/docs*` to it over a service binding.
