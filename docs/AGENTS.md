# skcal docs: agent instructions

Mintlify site for skcal, served at skcal.fit/docs (the site worker proxies
`/docs*` to Mintlify). Pages are MDX with YAML frontmatter; navigation lives in
`docs.json`.

## Keep it true to the code

- Check every claim against the worker before writing it: sign-in is in
  `src/worker/auth.ts`, API-key scopes in `src/shared/types.ts` (`API_SCOPES`),
  MCP tools in `src/worker/index.ts` (`registerTool`), training math in
  `src/worker/training.ts`, CLI commands in `packages/cli/src/index.ts`.
- `api-reference/openapi.json` is generated. Refresh it with
  `npm run docs:openapi` from the repo root; never hand-edit it.
- Validate with `cd docs && npx mint@latest validate` before pushing.

## Style

- Active voice, second person ("you"), one idea per sentence.
- Sentence case for headings. Bold for UI labels: **Train**, **profile → API keys**.
- Code formatting for commands, paths, endpoints, scopes, and keys.
- No em dashes.
