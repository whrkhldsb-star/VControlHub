# UI Upgrade Worklog: 2026-09-08

This phase builds on the previous audit. Previous full-suite coverage and
cross-browser results remain historical evidence; they do not certify the new
changes below. All builds and application writes use the isolated audit
environment. This phase was subsequently deployed on September 10; see
`docs/release-2026-09-10.md`. The next whole-site phase is tracked in
`docs/ui-site-upgrade-2026-09-10.md`.

## Implemented

- Shared spacing/control/typography tokens and a standalone, interactive
  component reference built from actual components and CSS. A separate browser
  command checks 18 theme/viewport/component states without a database.
- Server tabs reuse the common accessible control with panel associations,
  arrow/Home/End keys, permission-aware destinations and bookmark restoration.
- Server inventory supports name/host/tag search, combined status/channel
  filters, empty results and 12 cards per page. It bounds mounted probes but
  still receives the complete metadata list from the server.
- Server cards use fewer borders, larger secondary labels, wrapping status
  labels and aligned action rows.
- A diagnostic hook deduplicates manual/automatic calls, validates metrics,
  aborts browser requests on identity change/unmount, times out stuck transports
  and rejects stale responses without releasing a newer request's lock.
- Files reuse the shared toolbar/action controls while retaining backend
  pagination, selection invalidation, sorting and upload-dialog behavior.
- Settings use a common tab bar and desktop rail/mobile category select,
  include config import/export in category navigation, preserve mounted drafts,
  reject unauthorized hashes and preserve framework history state.
- Unified settings owns its delayed scrolling. Nested settings no longer runs
  duplicate hash scrolls; outstanding timers are canceled on navigation/unmount.
- Config imports invalidate previous file reads and previews immediately,
  ignore obsolete responses, abort preview requests and lock file/options during
  execution. Confirmation consumes its preview, so repeating an import requires
  another preview.

## Verification history

- Initial related regression batch: 20 files / 186 tests passed.
- Additional config-import and settings regressions: 2 files / 10 tests passed
  (7 overlap the initial batch; 3 are new import tests).
- Full typecheck and lint passed after application changes.
- Translation completeness: no missing keys or Chinese/English mismatches;
  67 possible unused/dynamically referenced keys remain.
- First component-reference check: 18 states passed; font fallback corrected
  after visual inspection and will be rechecked.
- The final September 10 build passed. The representative UI/public-route suite
  passed 54 cases across Chromium, Firefox and WebKit; 16 authenticated workflow
  cases passed on Chromium. Those results certify this phase's tested scope,
  not the later whole-site changes.

## Remaining Migration

Monitoring/health, operations/jobs and specialized AI/media workspaces are
included in the subsequent whole-site phase. This historical phase does not
claim that every application page was redesigned or that all backend
bottlenecks were removed.

See `docs/ui-system.md` for the implementation map and reproducible commands.
