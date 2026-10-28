# skcal docs: agent instructions

[Blume](https://useblume.dev) site for skcal, served at skcal.fit/docs (the
site worker forwards `/docs*` to the `skcal-docs` worker). Pages are MDX under
`content/`; the sidebar comes from the folder tree and each group's `meta.ts`.
Config lives in `blume.config.ts`. Blume's own agent skills and docs ship in
`node_modules/blume/skills` and `node_modules/blume/docs`.

## Keep it true to the code

- Check every claim against the worker before writing it: sign-in is in
  `src/worker/auth.ts`, API-key scopes in `src/shared/types.ts` (`API_SCOPES`),
  MCP tools in `src/worker/index.ts` (`registerTool`), training math in
  `src/worker/training.ts`, CLI commands in `packages/cli/src/index.ts`.
- The API reference is generated from `../src/worker/openapi.gen.json`. Refresh
  it with `npm run openapi:gen` from the repo root; never hand-edit it.
- Run `bun run build` and `bun run validate` in `docs/` before pushing.
- Use `:::note` / `:::tip` directives for callouts and Lucide icon names.

## Style

- Active voice, second person ("you"), one idea per sentence.
- Sentence case for headings. Bold for UI labels: **Train**, **profile → API keys**.
- Code formatting for commands, paths, endpoints, scopes, and keys.
- No em dashes.
