<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CI & Local Verification (Mandatory for All Agents)

- **Remote GitHub Actions CI (`.github/workflows/ci.yml`) is manual-only (`workflow_dispatch`).** Pushing commits or opening PRs will **not** trigger remote CI automatically.
- **Do NOT wait for or watch remote CI** (do not `watch_pull_request` waiting for automatic checks, and do not trigger `gh workflow run ci.yml` unless the user explicitly asks).
- **Run all verification locally before committing/merging:**
  - Fast gate (typecheck + lint + RBAC/i18n/copy/docs audits + unit tests): `npm run ci:local`
  - Full gate (+ coverage + Next.js build + runtime bundle): `npm run ci:local:full`
  - Faster local Vitest concurrency (default `vitest.config.ts` caps `maxWorkers: 2` for 2-vCPU runners): `npx vitest run --maxWorkers=8` (or with `--coverage`)
  - PostgreSQL integration tests (against a dedicated disposable `*_test` DB): set `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vcontrolhub_test` and run `npm run ci:local` (or `RUN_DATABASE_INTEGRATION_TESTS=1 npx vitest run integration --maxWorkers=1 --no-file-parallelism`)
  - Targeted E2E (Chromium only, against a disposable `*_test` DB): `npx playwright test <spec> --project=chromium`
- On Windows dev machines where `node`, `bash`, or `pg_ctl` are not on the default `PATH`, prepend the local toolchain paths (e.g. `E:\platform\node-v22.23.2-win-x64;C:\Program Files\Git\bin;E:\platform\pgsql\bin`) before running commands.

See [docs/ci-gates.md](docs/ci-gates.md) for local gates, branch protection, and CI footguns.
