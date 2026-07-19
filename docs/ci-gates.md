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

## Artifact reuse

The `test` job uploads `.next/` + `dist/` as `next-runtime-build` with `include-hidden-files: true` (required for `.next`). E2E and DAST
download it instead of rebuilding. If you change Next config or public assets,
ensure they are included in the upload path list in `ci.yml`.
