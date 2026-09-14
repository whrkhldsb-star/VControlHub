# Whole-site UI upgrade — 2026-09-10

## Scope and implementation

This phase extends the deployed September 10 design system across the frontend.
The route catalog contains 54 page files, including redirect aliases and dynamic
details. Verification results below refer to the actual cases run, not to every
possible data/permission state.

- Geometry: 8px controls, 12px list/cards, 16px dialogs; consistent list headers,
  page actions, empty states, table rhythm and modal scrolling.
- Readability: removed 10/11px metadata and undersized action overrides across
  136 components/pages, retaining semantic state colors and existing handlers.
- All route loading fallbacks share page gutters and navigation clearance.
- Health uses summary metrics and an explicit manual refresh; fleet status uses
  common filter controls with pressed state and shared summary cards.
- Task failure summaries use a neutral surface when no failures exist.
- AI fixes tablet navigation overlap, improves empty-state hierarchy, gives the
  conversation a proper page heading, wraps actions and exposes attachment
  removal on keyboard focus as well as hover.
- Media detail and file preview share headings/actions, with wrapping filenames.
- Image statistics use common metric cards and explicit proportional chart
  heights instead of percentage heights inside an indefinite-height container.
- Public status and public authentication/fallback screens no longer nest main
  landmarks inside the root layout. Public status shares the page heading.
- AI Ops uses neutral panels, section headings and stacked filter labels.
- Populated AI conversations keep long titles above mobile actions and use
  readable upload hints; sidebar conversations support keyboard selection.
- Dialog geometry is enforced above legacy utility classes (computed 16px).
- Public share markers no longer cover the heading or use low-contrast opacity.
  Narrow text previews give controls and the document more space.

## Validation

- Standalone components: 18 theme/viewport/interaction states passed.
- Initial 320px English/light sweep: 43/45 passed. Monitoring and traffic tables
  lacked keyboard-focusable horizontal scrolling; both were corrected.
- Frontend/component/API regression batch: 318 files / 2,278 cases. One stale
  login assertion expected a nested main landmark; its corrected test passed in
  the subsequent 14-file / 74-case focused regression batch.
- Build, lint and dictionary completeness passed. The build uses an isolated
  tree; production build artifacts remain untouched during verification.
- Populated AI workspace: all 12 combinations passed after correcting the
  upload hint contrast and long-title layout. AI focused unit tests: 17 passed.
- Final Chromium route matrix: 540/540 passed (45 concrete pages × 2 languages
  × 2 themes × 320/768/1440px). The earlier interrupted run is not counted.
- Product workflows: 52/54 passed initially. The two failures were the
  low-contrast public share marker and a missing isolated Playbook executor.
  Both passed their focused rerun, including all 24 file-preview/share states.
  File preview/share component regression: 14 tests passed.
- Dynamic/public detail inspection covers 96 theme/locale/width states across
  file preview, public share, media detail, ticket detail, login, public status,
  offline, and a real two-factor challenge. All passed after the share fix.
- Firefox/WebKit: 188/192 passed initially; four API-documentation screenshots
  exceeded the browsers' 32,767px bitmap limit. Bounded screenshot slices retain
  the full page, and all four focused reruns passed. This covers 180 route states,
  eight public smoke cases, two authenticated flows and two AI workflows (the
  AI workflows inspect another 24 theme/locale/width states).
- The checks include runtime errors, document response, headings, one main
  landmark, horizontal overflow, clipped controls and automated WCAG A/AA scans.
  Automated accessibility checks and screenshot review do not cover every
  permission, data volume, external provider, assistive technology or error state.

## Production release

Published successfully at **2026-09-10 13:22:04 UTC** to
https://whrkhldsb.qzz.io, build `gACaTIqh2Q8ksQFR0HeOn`.
The Next server, background worker and SSH WebSocket service restarted
successfully. All 26 deployment smoke checks passed. At 15:03 UTC all three
services remained active with zero automatic restarts. Previous build/runtime
artifacts and the pre-release database/configuration backup are retained.
Public verification at 15:04 UTC: all 12 Chromium/Firefox/WebKit public smoke
cases passed; `/api/status` reported `healthy`. No production test account or
product data was created. The isolated preview and Playbook executor were then
stopped. The authenticated health endpoint correctly rejects anonymous access.

## Review artifacts

Artifacts are retained locally in `/root/vcontrolhub-ui3-20260910`:

- `gallery.html`: 540 full-site screenshot entries with route/theme/locale filters.
- `details.html`: dynamic pages and populated interaction screenshots.
- `components-final/index.html`: interactive shared-component reference.
- `matrix.json`, `cross.json`, `cross-corrected.json`, `workflows.json`,
  `corrected-workflows.json`, `workspace-final.json`: original results and reruns.
- `changed-source.json`: 204 source files changed during this UI phase.

Release preparation and the backup/rollback scripts are retained in
`/root/vcontrolhub-ui3-release-20260910`. No schema migration is required.

## Per-route coverage

Each ordinary matrix row passed 12 Chromium states and four Firefox/WebKit
states. Dynamic details and aliases have the explicitly listed coverage.

| Route | Verified coverage |
| --- | --- |
| `/account` | Redirect → /account/security; workflow verified |
| `/account/password` | 16 route states |
| `/account/security` | 16 route states |
| `/ai-ops` | 16 route states |
| `/ai` | 16 route states |
| `/alert-rules` | 16 route states |
| `/announcements` | 16 route states |
| `/api-docs` | 16 route states |
| `/api-tokens` | 16 route states |
| `/audit` | 16 route states |
| `/backups` | 16 route states |
| `/cost-summary` | 16 route states |
| `/dashboard` | Redirect → /; navigation workflow verified |
| `/deployments` | 16 route states |
| `/docker` | 16 route states |
| `/downloads` | 16 route states |
| `/files` | 16 route states |
| `/files/preview` | 16 route states + 12 real text-file states and file lifecycle |
| `/files/recent-downloads` | 16 route states |
| `/files/recycle-bin` | 16 route states |
| `/files/search` | 16 route states |
| `/files/sync` | 16 route states |
| `/files/webdav` | 16 route states |
| `/health` | 16 route states |
| `/image-bed` | 16 route states |
| `/itsm` | 16 route states |
| `/knowledge` | 16 route states |
| `/login` | 12 unauthenticated states + three-browser public smoke |
| `/login/verify-2fa` | 12 valid challenge states + setup/login/disable lifecycle |
| `/media/[id]` | Real uploaded media detail: 12 states + lifecycle |
| `/media` | 16 route states |
| `/monitoring` | 16 route states |
| `/notifications` | 16 route states |
| `/offline` | 16 route states |
| `/operation-tasks` | 16 route states |
| `/` | 16 route states |
| `/playbooks` | 16 route states |
| `/preferences` | Redirect → /settings#personal-preferences; workflow verified |
| `/quick-services` | 16 route states |
| `/requests` | 16 route states |
| `/scheduled-tasks` | 16 route states |
| `/servers` | 16 route states |
| `/settings` | 16 route states |
| `/share/[token]` | Real public share: 12 states + file lifecycle |
| `/shares` | 16 route states |
| `/snippets` | 16 route states |
| `/status` | 16 route states |
| `/storage` | Redirect → /files; workflow verified |
| `/templates` | 16 route states |
| `/tickets/[id]` | Real ticket detail: 12 states + CRUD |
| `/tickets` | 16 route states |
| `/traffic` | 16 route states |
| `/users` | 16 route states |
| `/vps-status` | 16 route states |
