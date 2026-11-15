# CI gates & branch protection

This repo's GitHub Actions workflow (`.github/workflows/ci.yml`) is the source
of truth for "is main healthy?". Local deploys (`deploy.sh` smoke) are **not** a
substitute — they skip typecheck, lint, coverage, e2e, and dast.

## Required before push to `main`

```bash
# Fast (typecheck + lint + unit tests) — use for most commits
make ci-local
# or: npm run ci:local

# Include PostgreSQL integration tests against a dedicated disposable database
TEST_DATABASE_URL=postgresql://... npm run ci:local

# Full parity with GitHub "test" job (adds coverage + next build + runtime)
make ci-local-full
# or: npm run ci:local:full
```

On Linux outside CI, `npm run build` first asks systemd about
`vcontrolhub-next.service` and refuses when it cannot tell that no live
installation is being overwritten — which includes a checkout on a machine
that has no such service. In a checkout that is not an installation, run the
full gate as `VCONTROLHUB_ALLOW_BUILD=1 npm run ci:local:full`. Never set it in
the directory an installation serves; use `deploy.sh` there.

Optional pre-push hook (repo-local, not forced):

```bash
git config core.hooksPath .githooks
# then every push runs `make ci-local` unless CI_SKIP=1
```

## RBAC drift gate

`npm run rbac:audit -- --no-write` runs in the CI `test` job and in
`ci:local`. It exits 1 on any blocking drift — every drift code except the
soft `page-button-perm-unused` signal — e.g. a route whose
`declaredPermissions` it never enforces, or a permission missing from
`PERMISSIONS`. Intentionally public API routes are reviewed exceptions in the
`api-no-declared-perm` allowlist in `scripts/rbac-audit.ts`; add to it only
after review. Without `--no-write` the command also refreshes
`docs/rbac-audit.{json,md}`; `--report-only` keeps the old informational
exit 0.

## Dictionary and deployment-asset gates

The jobs run their steps one by one and none of them called `npm run verify`, so
two of its checks never ran in CI: a translation key missing from the
dictionaries (or present in one language only), and the deployment assets
(`deploy/verify-assets.sh`: the shell entrypoints parse, the systemd units render
and pass `systemd-analyze verify`, the Compose file is valid). Both run as unit
tests now, so the `test` job covers them without a workflow change:
`scripts/__tests__/i18n-key-completeness.test.ts` runs the key check on the code
base, and `deploy/__tests__/verify-assets.test.ts` runs the asset check wherever
`systemd-analyze` exists (Linux; it skips on Windows).

## GitHub Branch protection (one-time, repo admin)

In **Settings → Branches → Branch protection rules → main**:

1. Enable **Require a pull request before merging** (recommended) *or*
   **Require status checks to pass before merging** for direct pushes.
2. Require these status checks (names match the workflow job `name:` fields):
   - `test`
   - `E2E public smoke (Chromium + Firefox + WebKit)`
   - `test-windows` (Windows compatibility: typecheck/lint/unit/build on windows-latest)
   - `Docker fresh-install smoke` (image build, fresh migrations/seed and authenticated HTTP check)
3. Optionally require `DAST baseline (optional surface probe)` on `main` only
   (it already only runs on push to main).
4. Enable **Do not allow bypassing the above settings** for admins if the team
   agrees.

CLI (needs `admin:repo_hook` / repo admin token):

```bash
# Example — adjust owner/repo
gh api -X PUT repos/OWNER/REPO/branches/main/protection \
  -f required_status_checks='{"strict":true,"contexts":["test","E2E public smoke (Chromium + Firefox + WebKit)","test-windows","Docker fresh-install smoke"]}' \
  -F enforce_admins=true \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

If the API shape above fails on your plan, use the GitHub UI — the check names
must match the Actions job names exactly.

## Known CI footguns (do not reintroduce)

| Footgun | Why it reds CI |
|---|---|
| Job-level `NODE_ENV=production` before `npm ci` | Skips devDependencies → missing `@tailwindcss/postcss` |
| Prisma `mockImplementation(async () => …)` without cast | Fails `tsc` (PrismaPromise ≠ Promise) — use `@/test/prisma-mock` |
| Bare `npm run build` on the live host | Blocked by `guard-live-next-build.mjs`; use `deploy.sh` |
| Counting pure re-export barrels in coverage | Drags global thresholds — already excluded in `vitest.config.ts` |
| Dual health UIs | Deleted; use `/health` + `/vps-status` only |
| Loading the bcrypt addon only inside test worker threads | Once the last worker holding it has exited, every later worker fails with `Module did not self-register`, so which files fail depends on the order they run in (a warm Vitest cache reorders them). `src/test/global-setup.ts` holds the addon in the main process for the whole run — keep it |
| A route that reads a large body behind `src/proxy.ts` | Next passes the route only the first `proxyClientMaxBodySize` bytes (34 MiB, `next.config.ts`) and does not fail the request. Keep the route's limit under it (`src/__tests__/next-config.test.ts` compares them), or leave the route out of the proxy's matcher and have it make the CSRF check and add the response headers itself |
| A response header set in `src/proxy.ts` | Next keeps the proxy's value and drops the route's own for the same name, so a policy set there replaces what the route chose (this is how the `sandbox` policy on user files was lost) |

## E2E / DAST build strategy

E2E and DAST jobs **build in their own runner** (not via cross-job `.next`
artifacts). Rationale, in order of importance:

1. **Root cause of the historical "connection refused" is fixed.** The custom
   server's `uncaughtException` handler used to `process.exit(1)` on any thrown
   error, including the benign `Error: aborted` that Next.js raises when a
   client (notably Playwright/WebKit) drops the connection after
   `domcontentloaded`. That killed the server mid-suite. `src/server.ts` now
   tolerates `aborted` / `ECONNRESET` / `ERR_STREAM_PREMATURE_CLOSE` / `EPIPE`
   and logs them at `warn` level instead of exiting.
2. **Local build is still cheaper than artifact transfer.** With the Next.js
   build cache (`actions/cache@v4` on `.next/cache`) warm, a rebuild in the
   e2e/dast job is ~1 min. Cross-job artifact upload + download of `.next/`
   (~200 MB, must include hidden files via `include-hidden-files: true`) plus
   `prisma db push` in the consumer job costs roughly the same wall-clock and
   adds a failure mode (stale `BUILD_ID`, partial upload).
3. **`.next/cache` is shared across jobs via the cache action**, so the e2e/dast
   rebuild benefits from the test job's compiled webpack modules without ever
   transferring `.next/` itself.

If you reintroduce cross-job `.next` artifact reuse later: set
`include-hidden-files: true`, verify `BUILD_ID` matches, migrate schema with
`prisma db push`, keep the server under `nohup` with a pid/log dump on failure,
and do **not** re-introduce a bare `process.exit(1)` on `uncaughtException`.

### Authenticated and product workflow gates

Each E2E job also checks the shared component reference (18 states) and the
whole-site UI plus populated AI workspace on Chromium, Firefox and WebKit.
The regular route matrix uses English/light/320px and Chinese/dark/1440px.
Nightly (02:23 UTC) and manually dispatched runs additionally inspect all 540
Chromium route combinations. These suites run sequentially because their
global setup/teardown share an isolated account. Artifacts use separate output
directories so later suites do not erase earlier evidence. Long documents are
captured in slices to respect Firefox/WebKit bitmap dimension limits.

The server-inventory workflow exercises 513 nodes, searching beyond the former
500-row limit, URL pagination/reload/back navigation and lazy batch targets.
It leaves the PWA service worker enabled. Visual fixtures that intercept
diagnostics block service workers, so worker activation does not compete with
Playwright request routing. Search assertions wait for the submitted URL before
checking the result count; equal page sizes alone do not prove a search ran.
Local rollback trees (`.next.*`, `node_modules.*`, `dist.*`) are excluded from
Git, TypeScript and ESLint inputs. Keep this exclusion when changing tooling.

The E2E job runs `e2e/authenticated-flow.spec.ts` on Chromium, Firefox, and
WebKit after public smoke:

- `prisma/seed.ts` seeds roles/admin so the app can boot cleanly
- `E2E_ISOLATED_ACCOUNT=1` creates `vcontrolhub_e2e` (ACTIVE, no password reset).
  It is an administrator with the password written in `package.json`, and
  teardown deletes its rows by name pattern, so setup refuses any database
  that is not on loopback **and** named as a test database: `test` or `audit`
  in the name, or `…_ci` while `CI=true`. To run a `test:e2e:*` script
  locally, point `DATABASE_URL` at such a database (for example
  `vcontrolhub_test`), never at the one an installation uses.
- `E2E_DIRECT_SESSION=1` mints a signed session cookie (avoids form-login +
  `mustChangePassword` redirects)
- Path covered: `/` → `/servers` → `/files` → `/settings` → dashboard chrome

The same step runs `e2e/public-status-board.spec.ts` on all three browsers: it
inserts public, hidden, maintenance, offline, never-sampled and 230 bulk status
board fixtures under a random prefix, restores the board's site row and deletes
the fixtures afterwards, and refuses any database that is not a loopback
audit/test/`_ci` database.

It then runs the complete non-destructive product workflow suite on Chromium.
That gate renders every concrete authenticated page and exercises CRUD, files,
media/image-bed, settings, monitoring, downloads, server diagnostics, and team
workspaces against an isolated account and synthetic unreachable VPS. Missing
fixtures are assertions, not silent skips. Full multi-browser coverage for all
workflow specs remains available through `npm run test:e2e:cross-browser`.

The workflow suite also includes populated provider/search/job-event dialogs
at narrow widths and short heights, plus live tenant and role-revocation API
checks. Tenant fixtures require a loopback audit/test database; CI additionally
accepts the workflow's dedicated `vcontrolhub_ci` database. These checks must not
target a production database.

Responsive route sweeps use a fresh browser context per route with the signed
test session restored. They wait for finite hydration/prefetch requests while
allowing persistent EventSource connections. Navigation and authentication
workflows retain their normal shared browser context. Avoid using unconditional
`networkidle` for monitoring pages, or reusing unresolved request bookkeeping
across hard navigations.

Hook tests must preserve stable context function identities and await observable
initial loading completion before testing actions. An empty `act` callback does
not guarantee a zero-delay mount timer has completed.

### Specs no workflow runs

`npm run test:e2e:nightly` runs every spec, but no workflow calls it: the
scheduled run only adds the full matrix of `ui-site`. Two specs that need
nothing beyond the isolated account had stopped matching the product while no
workflow ran them (fixed 2026-11-12: server fixtures without a customer were
invisible to the signed-in account, and the files spec drove the drive as it was
before its redesign): `ui-upgrade` (servers, files, settings, monitoring ×
language × theme × width, with axe) and `file-enhancements` (paused upload across
pages, favourites and tags, copy / move / delete jobs) are now part of
`npm run test:e2e:workflows`, which the E2E job already runs, so no workflow
changed. The specs below still run only when someone starts them; run them after
changing the pages they cover:

| Spec | Needs |
| --- | --- |
| `windows-rdp` | `E2E_RDP_CANARY=1` for the fixture test; the ticket test sends `E2E_RDP_ORIGIN` (by default the base URL) as its origin, which must be in the server's `SSH_WS_ALLOWED_ORIGINS` |
| `ssh-terminal-layout`, `ssh-terminal-modes`, `ssh-terminal-resilience` | the app **and** `dist/ssh-ws-proxy.js` on a test database, `E2E_SSH_LAYOUT_LAB=1` / `E2E_SSH_LAB=1`, and `SSH_WS_ALLOWED_ORIGINS` listing the app origin and the relay origins `http://127.0.0.1:3495`–`3497` |
| `audit-remediation-isolated` | a one-off environment (fixed port and database name); kept as a record |
| `live-production-acceptance` | a real installation and an explicitly authorised VPS; see the header of the spec |



## Layered coverage

`vitest.config.ts` enforces:

| Scope | lines | statements | functions | branches |
|---|---:|---:|---:|---:|
| Global | 70 | 68 | 68 | 55 |
| `src/lib/**` | 68 | 68 | 65 | 50 |

Route shells (`page.tsx` / `layout.tsx` / …) and pure re-export barrels are excluded
from the denominator so presentation churn does not red-CI the pipeline.

`src/lib/**` sits slightly below the global *line* floor because large
SSH/WebDAV/sync packages still lag unit coverage; raise it as those packages
gain tests, not by hoping CI will green on aspiration alone.


## Public status overall=warning (not a CI failure)

`/api/status` unauthenticated returns only `{ summary: { overall } }`. The
authenticated payload separates these checks:

| check | status | meaning |
|---|---|---|
| database | healthy | DB reachable |
| servers | healthy | enabled VPS inventory present (no live SSH probe) |
| storage | healthy / warning | warning when active storage is `UNHEALTHY` (e.g. SFTP auth failed / remote path missing), or no node has been checked |

So `overall: warning` is **expected** while any active storage node stays unhealthy —
fix the node credentials/path, do not treat the public summary alone as "app down".

Storage belonging to deleted customers (`Team.deletedAt` set) is excluded from
both status summaries and lazy health probes (`liveCustomerRowsWhere()` in
`lib/auth/team-scope`). Those records are retained for ownership history, so
missing retired directories must not cause live-service warnings. Legacy storage
with a null `teamId` still participates in health checks.

## Agent management boundary

- The lightweight host Agent uses its own outbound HTTPS protocol for heartbeat,
  metrics, and approved command jobs. It is not implemented as an SSH sampling
  extension and does not require an inbound port on managed hosts.
- Agent mode retains SSH credentials for bootstrap and automatic fallback.
  Once an Agent has claimed a command, the executor must not replay that command
  over SSH because mutation commands may not be idempotent.
- **GitHub branch protection** — must be flipped in repo Settings by an admin
  (require `test` + `E2E public smoke`).
