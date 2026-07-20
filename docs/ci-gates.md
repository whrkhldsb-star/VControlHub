# CI gates & branch protection

This repo's GitHub Actions workflow (`.github/workflows/ci.yml`) is the source
of truth for "is main healthy?". Local deploys (`deploy.sh` smoke) are **not** a
substitute — they skip typecheck, lint, coverage, e2e, and dast.

## Required before push to `main`

```bash
# Fast (typecheck + lint + unit tests) — use for most commits
make ci-local
# or: npm run ci:local

# Full parity with GitHub "test" job (adds coverage + next build + runtime)
make ci-local-full
# or: npm run ci:local:full
```

Optional pre-push hook (repo-local, not forced):

```bash
git config core.hooksPath .githooks
# then every push runs `make ci-local` unless CI_SKIP=1
```

## GitHub Branch protection (one-time, repo admin)

In **Settings → Branches → Branch protection rules → main**:

1. Enable **Require a pull request before merging** (recommended) *or*
   **Require status checks to pass before merging** for direct pushes.
2. Require these status checks (names match the workflow job `name:` fields):
   - `test`
   - `E2E public smoke (Chromium + Firefox + WebKit)`
3. Optionally require `DAST baseline (optional surface probe)` on `main` only
   (it already only runs on push to main).
4. Enable **Do not allow bypassing the above settings** for admins if the team
   agrees.

CLI (needs `admin:repo_hook` / repo admin token):

```bash
# Example — adjust owner/repo
gh api -X PUT repos/OWNER/REPO/branches/main/protection \
  -f required_status_checks='{"strict":true,"contexts":["test","E2E public smoke (Chromium + Firefox + WebKit)"]}' \
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

### Authenticated smoke (PR gate)

The E2E job also runs `e2e/authenticated-flow.spec.ts` on **Chromium only** after
public smoke:

- `prisma/seed.ts` seeds roles/admin so the app can boot cleanly
- `E2E_ISOLATED_ACCOUNT=1` creates `vcontrolhub_e2e` (ACTIVE, no password reset)
- `E2E_DIRECT_SESSION=1` mints a signed session cookie (avoids form-login +
  `mustChangePassword` redirects)
- Path covered: `/` → `/servers` → `/files` → `/settings` → dashboard chrome

Full multi-browser authenticated suite remains `npm run test:e2e:nightly` /
`test:e2e:cross-browser` (not every PR).



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

`/api/status` unauthenticated returns only `{ summary: { overall } }`. On this
deploy the authenticated payload currently shows:

| check | status | meaning |
|---|---|---|
| database | healthy | DB reachable |
| servers | healthy | enabled VPS inventory present (no live SSH probe) |
| storage | **warning** | one or more storage nodes `UNHEALTHY` (e.g. SFTP auth failed / remote path missing) |

So `overall: warning` is **expected** while any storage node stays unhealthy —
fix the node credentials/path, do not treat the public summary alone as "app down".

## Intentional non-goals (from improvement backlog)

- **Lightweight host agent / latency probe** — needs a separate protocol; do not
  bolt RTT onto SSH sampling.
- **GitHub branch protection** — must be flipped in repo Settings by an admin
  (require `test` + `E2E public smoke`).
