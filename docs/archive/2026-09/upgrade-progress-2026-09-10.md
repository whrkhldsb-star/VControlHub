# Project improvement follow-up — 2026-09-10

This phase follows the deployed whole-site UI upgrade and was released to
production on September 10 at 16:07:32 UTC.

## Implementation

- Server inventory now counts, searches and filters in PostgreSQL, with stable
  12-row pages and a repeatable-read snapshot. The page no longer uses the old
  500-profile query. Global summary counts remain independent of filters.
- Search matches name, host and partial tags case-insensitively, escaping SQL
  wildcard characters. Search submits with Enter or the search button. Filters
  and page navigation use the URL and preserve the selected tab hash.
- Command and batch panels fetch sanitized target options only when opened.
  Both require server-read plus their operation permission. Options include all
  authorized targets; large operation selectors remain a future pagination task.
- SSH commands accept AbortSignal, close only their own channel and release
  pooled references, including connections acquired after cancellation. The
  realtime diagnostic route forwards Request.signal to the SSH call.
- Agent cancellation stops polling and cancels pending work atomically. Claimed
  work is not replayed through SSH or falsely reported as rolled back. Closing
  an SSH channel cannot guarantee termination of detached remote processes.
- CI runs the component reference and two locale/theme/viewport combinations
  across Chromium, Firefox and WebKit on each run. Nightly/manual runs also
  execute the full 540-case Chromium matrix. Browser jobs allow 90 minutes and
  retain component and UI artifacts separately from product workflows.
- Git, TypeScript and ESLint ignore local promotion/rollback directories.

## Validation

- PostgreSQL: three integration tests passed, including all 525 scoped nodes
  across 44 pages, literal tag searches, combined filters, empty results,
  out-of-range pages, tenant quarantine and sanitized operation targets.
- SSH/server/monitoring: 24 files / 195 tests passed. This includes real SSH
  cancellation while another pooled channel remains active, late-open cleanup,
  Agent cancellation, diagnostics and server UI regressions.
- Final production build, TypeScript and full ESLint passed. The initial build
  caught Next's generated PageProps constraint on a defaulted argument; the page
  signature and tests were corrected before the successful build.
- Final page/action tests: two files / 10 tests passed; translations have no
  missing/mismatched keys. Deployment assets and source/build digest match.
- Route audit: 54 pages, 181 API routes and 54 page permission mappings;
  RBAC audit: 628 call sites with no drift. API-copy audit passed its existing
  baseline (411 findings), which is not a claim that all API copy is cleaned up.
- The production-directory TypeScript input scan included 4,237 files and no
  rollback files. README metrics and Git whitespace checks passed.
- Browser coverage spans 144 page states across Chromium, Firefox and WebKit:
  Chinese/English, dark/light and 320/768/1440px. The first run passed 59 of 60
  cases; one WebKit search case stalled while service-worker activation and
  mocked diagnostics shared the request-routing path. Five controlled reruns
  passed with service workers blocked for mocked fixtures.
- Final focused acceptance passed all 45 cases without retries or skips:
  36 server-page visual/accessibility combinations, three inventory workflows
  with 513 nodes and PWA enabled, and six inventory/settings workflows.
  The 108 visual states on files/settings/monitoring and 15 public/login cases
  retain their passing results from the first run. Small-screen screenshots
  also capture the search toolbar and node cards below the initial viewport.
  Mocked visual fixtures mark the service-worker API unsupported to avoid a
  test-induced registration-error toast; real PWA workflow tests keep it enabled.
- PostgreSQL backup validated and promotion smoke-failure rollback simulation
  passed. All 26 production deployment checks and all 12 public browser checks
  passed after promotion. Next, worker and SSH WebSocket services are active with
  zero automatic restarts; the public status endpoint reports healthy.

## Production release

- URL: https://whrkhldsb.qzz.io
- Build: `qzYgAeLJ0PYC7afKeoB4B`
- Source/build input SHA-256:
  `c7851a5acc23b6e1b9d2599d3af1c69512d40fc3df5cd9060637d3cf98aebaeb`
- Prior runtime artifacts remain under the `previous-20260910-upgrade4` suffix.
  No database migration was needed. The release directory retains the validated
  database/config backups, promotion script, rollback simulation and smoke logs:
  `/root/vcontrolhub-upgrade4-release-20260910`.
- Browser and regression evidence:
  `/root/vcontrolhub-upgrade4-20260910`. The initial failing and interrupted
  diagnostic runs are retained; `browser-accepted.json` is the final 45-case
  acceptance result and `production-public.json` is the post-release result.

## Version tracking

Recovery reference: `refs/checkpoints/vcontrolhub-upgrade4-20260910`, recorded
using a separate Git index. It includes the earlier authorized changes present
in this working tree; the ordinary index, branch and working files remain
available for review. The commit ID and file manifest are recorded in the release
directory as `checkpoint.json` and `checkpoint-files.txt`. Runtime environment
files, build/rollback trees and matching runtime secret values are excluded.
There was no remote push. GitHub Actions configuration is ready locally;
remote CI runs and branch-protection activation are not verified by this release.

## Remaining broader work

Queue fairness and recovery after a forced process kill during external writes,
sustained capacity testing, real vendor/AI integrations, and API-copy cleanup
remain separate work. No result in this phase certifies these areas.
