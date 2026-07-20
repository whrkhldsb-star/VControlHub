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

## Artifact note

E2E and DAST **build in their own job** (not via cross-job `.next` artifacts).
Cross-job artifact reuse of `.next` was attempted and abandoned: the production
custom server intermittently died mid-suite with connection refused under
multi-browser Playwright. Local rebuild is slower but reliable.

If you reintroduce artifact reuse later: set `include-hidden-files: true` for
`.next`, verify `BUILD_ID`, migrate schema with `prisma db push`, and keep the
server under `nohup` with a pid/log dump on failure.

## Layered coverage

`vitest.config.ts` enforces:

| Scope | lines | statements | functions | branches |
|---|---:|---:|---:|---:|
| Global | 70 | 68 | 68 | 55 |
| `src/lib/**` | 72 | 70 | 70 | 55 |

Route shells (`page.tsx` / `layout.tsx` / …) and pure re-export barrels are excluded
from the denominator so presentation churn does not red-CI the pipeline.

## Intentional non-goals (from improvement backlog)

- **Lightweight host agent / latency probe** — needs a separate protocol; do not
  bolt RTT onto SSH sampling.
- **GitHub branch protection** — must be flipped in repo Settings by an admin
  (require `test` + `E2E public smoke`).
