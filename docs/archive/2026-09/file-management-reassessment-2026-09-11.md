# File management reassessment (2026-09-11)

## Evidence and deployment state

This assessment is based on the current source, tests and installed build,
not earlier conversational completion claims. The installed build at the
start of this review was `yM_-s6U8QwcQp2_MN50No`. An artifact directory named
`.next.failed-20260910-upgrade5b` confirms the later promotion rolled back.
Source changes and successful builds are not evidence of deployment.

The earlier 54-page / 181-route counts describe static catalog and permission
coverage. They do not establish that every feature has passed a complete
interactive or third-party integration review.

## Work completed in this reassessment

- Batch move now offers a same-node destination picker with directory navigation,
  pagination, root selection, retry and request cancellation on close. Manual
  paths remain available, including for mixed-node batches. Mixed-node batches
  still interpret the path independently in each source node; they are not
  cross-node transfers.
- Batch move/delete catch rejected requests per item and continue the batch.
  Only failed IDs remain selected, so retry does not resubmit successful items.
  A synchronous guard blocks duplicate submissions while the batch is running.
- Move loads WebDAV credentials, pinned SSH host keys and Agent routing metadata.
- Directory moves into a descendant are rejected before external writes.
- Single-item move refreshes the listing without a forced browser reload.
- Ctrl/Cmd+A selects all eligible files instead of toggling them, only when
  focus belongs to the file list. Input controls, active batches and modal
  dialogs are excluded. Modal focus handling owns Escape.
- The batch toolbar wraps within narrow viewports; target editing and cancel
  are disabled during an in-flight move.

## Starting feature backlog

| Priority | Item | Actual starting point | Completion criteria |
| --- | --- | --- | --- |
| P1 | Safe copy/move conflict handling | Move rejects indexed collisions; uploads can overwrite; no unified user policy | Cover skip/replace/rename, physical unindexed objects, recycle-bin occupants, quotas, ACLs and concurrent writers; preserve originals on failure |
| P1 | Copy files and directories | No file-browser copy command; WebDAV protocol COPY is not a browser workflow | Bounded streaming/backend-native copy, recursive limits, cancellation, metadata consistency; explicit same-node versus cross-node support |
| P1 | Upload queue controls | Files/folders can be selected; dropzone accepts files; chunks support resume internally | Visible pause/resume/cancel/retry, stable destination and per-file IDs, accurate results when the dialog closes, no duplicated successful uploads |
| P1 | Batch execution and navigation | Move/delete are sequential browser loops | Bounded server-side scheduling, conflict isolation and progress that survives navigation; late completion cannot overwrite a new selection |
| P2 | Single-item destination browsing | Single move still uses inline path input | Reuse destination picker for files/directories; block descendants and preserve node identity |
| P2 | Drag and drop | Upload dialog already accepts file drops | Whole-browser file/folder upload with relative paths; internal drag-to-move with destination/ACL checks and confirmation |
| P2 | Favorites and quick directories | No file-browser favorites model/UI | Per-user/team ownership, stable entry identity, removed-item cleanup and keyboard/touch access |
| P2 | Tags | Other domains have tags; file-browser tagging is absent | Permissions, assignment/removal, search/filtering, persistence and pagination |
| P2 | Recent files/directories | Recent downloads already exist | Track visits/opens separately from downloads, enforce read permission, maintain bounded history |
| P2 | Selection parity | Batch selection covers eligible files on the current page | Define folder and cross-page selection behavior, read-only batch downloads and range selection across views |
| P2 | WebDAV upload parity | Browser lists WebDAV as a node; uploader currently enables only LOCAL/SFTP | Align advertised capabilities and supported transport; test actual WebDAV upload lifecycle |

## Other modules

Download retry, share creation, server selection, task progress, notifications,
backups/restores and AI streaming should be checked for the same failure modes:
duplicate submission, partial success, stale completion after navigation and
misleading capability controls. This is a follow-up review list, not a claim
that those modules have newly passed end-to-end review in this change.

## Verification

Focused regression tests exercise batch transport rejection and double submit,
move metadata and descendant rejection, keyboard selection, and destination
browsing/root/pagination/retry/cancellation. Browser workflow coverage includes
the destination dialog at desktop and mobile widths. Build, test and release
evidence is stored under `/root/vcontrolhub-file-audit-20260911`.

Verified in this run:

- 29 file/upload test files: 224 tests passed.
- Chromium file lifecycle including desktop/mobile destination dialog: passed.
- Production Next build and runtime bundles: passed.
- TypeScript: passed with `NODE_OPTIONS=--max-old-space-size=4096` after the
  default 2 GB heap was exhausted. A running process was not counted as a pass.
- Full ESLint, i18n key completeness, API copy audit and deployment assets: passed.
- No database schema change is required for these corrections.

## Deployment

Promoted successfully at 2026-09-11 12:43:51 UTC. Installed build:
`mvE26hTW-x8Inrha7PpTa`. All 26 deployment smoke checks passed; the three
application services are active and public `/api/status` reports healthy.
Previous artifacts are retained with suffix `20260911-files1` for rollback.
Public Chromium, Firefox and WebKit smoke: 12 tests passed after promotion.

## File enhancement release

The subsequent enhancement implements the six agreed file-browser workstreams:

- Files and directories have copy commands with skip, automatic rename and
  overwrite policies. LOCAL, SFTP and WebDAV adapters are supported. Recursive
  enumeration includes backing files missing from the index and empty folders,
  excludes recycled entries, checks ACLs and caps traversal at 10000 entries.
- Uploads use a shared queue with two concurrent files, visible pause/resume,
  cancellation, cleanup retry, upload retry and progress. The queue survives SPA
  navigation and closing its dialog. Chunk sessions are scoped by account/team;
  acknowledged chunks resume after selecting the same file again. Rate-limited
  chunks respect Retry-After. Lost completion responses reconcile the original
  session instead of blindly overwriting again.
- Copy and batch move/delete are durable database jobs, with bounded scheduling,
  per-item results, progress, cancellation between roots and selective retries.
  Active jobs are retained separately from the latest 30 terminal jobs, so a
  long-running operation cannot disappear behind newer completed operations.
  Request IDs prevent duplicate submission. Worker permissions and original team
  membership are checked again before each root. Ambiguous and partially copied
  results are excluded from automatic/manual failed-item retry lists.
  Source path ACLs are also checked before enqueueing, so rejected paths never
  become task-history names visible to the requester.
- External file/folder drops work over the file browser. Internal same-node
  drag-to-move requires an actual writable destination folder and confirmation.
  Virtual groups are never treated as real drop destinations.
- Favorites, tags and recent file/folder access persist per user/file identity.
  Lists filter current team, deleted files and current path permissions; moves
  preserve the saved identity. Collections support tag filtering and pagination.
- All views support folder selection. Selection survives pagination within the
  same folder/filter, and select/deselect-page preserves other pages. Single and
  batch moves share a destination browser. Selection is capped at 1000 entries.

Safety and operating boundaries:

- Copy stays within each source storage node. Cross-node transfers are not part
  of this release. Move rejects conflicts rather than replacing existing files.
- Browser File objects do not survive a full browser reload. Reselecting the
  original large file resumes acknowledged chunks; this is not an unattended
  upload daemon after the browser closes. Files below 5 MiB use one request and
  cannot pause once committing; ambiguous responses are shown as unconfirmed.
- Folder upload preserves paths of contained files. Empty dropped directories
  are not created. Empty directories are preserved by server-side copy.
- Directory operations are not atomic filesystem transactions. Partial results
  and recovery paths are reported for inspection. The copy/move/delete node
  lock does not serialize arbitrary external writers. Staging, source metadata
  checks, physical collision checks and compensating rollback reduce race risk.
- Cancellation of a durable batch waits for its current root operation. Worker
  crashes do not automatically replay uncertain writes. Agent-only SFTP fallback
  retains the existing buffered transfer implementation.
- Range selection and read-only batch downloads from the broader starting
  backlog are not introduced by these six workstreams. This document does not
  claim a new end-to-end review of unrelated feature modules.

Release evidence: `/root/vcontrolhub-files-enhancement-20260911/`. Isolated
OpenSSH tests verify real remote file/directory copying and conflict policies;
WebDAV HTTP tests verify native COPY bytes, non-overwrite and partial-response
handling. Third-party WebDAV providers have not each been certified.

The full regression run completed with 664 passing test files / 5585 passing
tests, with 24 conditional tests skipped. Six additional operation-list and
source-path authorization tests passed after that run's
test discovery. The isolated LOCAL/OpenSSH/WebDAV verification passed 19 tests,
including the real SFTP cases skipped without its fixture configuration.
Full lint plus checks for the final edits, production build/type checking,
runtime bundles, schema formatting, API copy, i18n, route/RBAC audits, README
metrics and deployment assets passed. RBAC audit reports zero drift.

The final build `2W2un_ekS2zAf_h9Fbq7T` passed all nine file workflow tests
across Chromium, Firefox and WebKit. This includes byte-for-byte upload/copy
verification, pause/navigation/resume, drag-to-move, collections, deletion and
share downloads. Share download links now explicitly carry the native download
attribute after WebKit exposed a missing download event despite an HTTP 200
attachment response. Desktop/mobile screenshots were inspected. Upload fault
injection tests block service workers so interception remains deterministic;
the resulting registration-warning toast in those screenshots is fixture-induced.
Final browser evidence is in `shipping-browser.log` and `browser-shipping/`.

### Enhancement deployment result

Promoted at 2026-09-11 14:48:38 UTC to production
`https://whrkhldsb.qzz.io`, build `2W2un_ekS2zAf_h9Fbq7T`.
The 70-file source snapshot and installed source both match the validated
build-input SHA256 `48ee03c6f4eee58e2f50d7cffb722d66543e099281f9f0c91d23b032de444f9e`.

- A full PostgreSQL custom-format backup was verified before applying
  `20260911131500_file_preferences`; the additive migration completed.
- Next, worker and SSH WebSocket services restarted successfully. All 24
  background workers started without failure, including `file-operations`.
- All 26 deployment smoke checks and 12 public Chromium/Firefox/WebKit tests
  passed. Public status reported `healthy`; new operations/preferences endpoints
  returned the expected unauthenticated 401 responses.
- Systemd configuration was reloaded to clear pre-existing stale-unit warnings.
  All three application services remained active with zero automatic restarts.
- Old artifacts remain at `/opt/VControlHub/{.next,dist,node_modules}.previous-20260911-files2`.
  Original source files and the database backup are retained in the release
  evidence directory. The audit server and audit-only file worker were stopped
  after verification; browser tests did not create accounts in production.
  The audit Next server closed its listener but exceeded systemd's 90-second
  graceful-stop timeout and was terminated; this was an audit cleanup failure,
  not a production service or test failure.

Evidence: `promotion.log`, `migration.log`, `smoke.log`, `public-browser.log`,
`browser-public/`, `source-manifest.json`, `source-before/` and
`before-file-preferences.dump` under the release evidence directory above.
