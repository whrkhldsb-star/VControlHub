# VControlHub Autonomous Remediation Backlog

Created: 2026-05-29
Purpose: durable handoff for multi-round autonomous remediation and optimization. Each cron run must read this file first, choose a coherent batch, fix it, verify, deploy, commit/push, then update this file.

## Operating rules

- Do not rely on chat context. This file is the source of truth for remaining work.
- This remediation loop is distinct from the older paused general site-check loop:
  - Old paused job `a8e21e83a7df`: broad website issue discovery + small automatic fixes/upgrades.
  - Current job `b8833e83bb1f`: backlog-driven remediation and optimization from this stored checklist.
- Runs are scheduled every 10 minutes, but must be non-overlapping. If the previous remediation run is still active, skip the new tick and report/record a skipped-overlap event instead of starting another fix.
- Keep fixes deployable. A run may do a small coherent batch, or a larger architecture/code change if it materially improves performance, availability, completeness, maintainability, or user experience and can still be verified.
- Prefer functional availability and end-to-end correctness over cosmetic-only work, but UI/UX polish is valid when it improves usability.
- Add or update regression tests for behavior fixes where practical.
- Required validation before commit/push unless explicitly blocked: `npm run typecheck`, `npm run lint`, targeted tests, `npm run build`, `npm run build:runtime`, production restart of `vcontrolhub-next.service vcontrolhub-ssh-ws.service`, `./deploy/smoke-test.sh whrkhldsb.qzz.io vcontrolhub`, recent service log check.
- If production restart is blocked by approval policy, do not commit/push as deployed. Leave worktree verified but uncommitted, record blocker below, and report.
- After each completed item, mark it `[x]` with date, commit hash if available, and short verification notes.
- After the recommended current backlog is completed, or after roughly 6 successful remediation runs, perform a fresh comprehensive audit, update this checklist with newly discovered issues, then continue remediation/optimization.
- Routine successful runs should be silent to the user. Only send a user-facing summary after 6 successful remediation runs, when the backlog is basically completed/fresh audit is performed, or when a blocker/failure requires attention. Still update backlog/state every run.
- Broad improvements are allowed: architecture, code, API design, UI, performance, reliability, feature completeness, observability, tests, deployment scripts, and docs/UX copy, as long as they improve the live website and pass verification.

## P0 — Download task resource authorization

- [x] 2026-05-29 — Restrict `GET /api/downloads` so users only see owned tasks or tasks whose target storage path is readable. Verification: route regression `filters download list to owned tasks or readable storage targets`, targeted Vitest, typecheck, lint, build, runtime build, production smoke 19/19 passed.
- [x] 2026-05-29 — Restrict `PATCH /api/downloads` task actions (`pause`, `resume`, `refresh`, per-task speed) to task owners or callers with target storage write authority. Verification: cross-user forbidden control regression plus existing real-process-state regressions passed.
- [x] 2026-05-29 — Restrict `DELETE /api/downloads` cancel/delete to task owners or callers with target storage delete authority. Verification: cross-user forbidden cancellation regression plus existing cancellation side-effect regressions passed.
- [x] 2026-05-29 — Require `storage:manage-node` for `globalMaxSpeedKb` instead of only generic `storage:write`. Verification: global limit permission regression passed.
- [x] 2026-05-29 — Add route/service tests covering cross-user task visibility and forbidden cross-user control. Verification: `npx vitest run src/app/api/downloads/__tests__/route.test.ts` passed 16/16.

## P1 — Ticket permission model

- [ ] Split or normalize ticket permissions so normal authenticated users can create tickets without broad `ticket:manage`.
- [ ] Make manager/admin ticket list return all tickets; normal users should only see created/assigned tickets.
- [ ] Keep ticket detail/comment access consistent for creator, assignee, and manager/admin.
- [ ] Update RBAC seed/tests if adding permissions such as `ticket:create`, `ticket:read`, `ticket:manage`.
- [ ] Add regression tests for create/list/comment/update paths.

## P2 — Storage and file-size safety

- [ ] Add SFTP read/preview size limit in `src/app/api/storage/sftp-ops/route.ts`; large files should return a clear error and require download instead of inline read/base64 JSON.
- [ ] Add local upload pre-read size checks using `File.size`/Content-Length where available before `arrayBuffer()`.
- [ ] Review `src/lib/storage/access-control.ts` default no-grant fallback; migrate toward default deny or a compatibility flag with explicit admin/storage-manager fallback.
- [ ] Add tests for over-limit SFTP read and over-limit local upload.

## P3 — Quick Services permission and task robustness

- [ ] Replace Quick Services `user:manage` permission with `quick-service:manage` or `docker:manage` consistently in routes/UI/RBAC.
- [ ] Add seed/test synchronization for any new permissions.
- [ ] Add install/uninstall idempotency guard or task-lock to prevent concurrent operations on the same slug.
- [ ] Improve Quick Services install failure visibility/logging and cleanup state.

## P4 — UI availability and polish

- [ ] Replace mobile nav index references in `src/components/nav-items.tsx` with href-based selection; confirm intended bottom items.
- [ ] Replace remaining `window.location.reload()` in server actions/forms with `router.refresh()` or local state refresh: `server-card-actions`, `create-announcement-form`, `create-ticket-form`.
- [ ] Add empty state for SFTP browser when no SFTP nodes exist, with link/action to create storage node.
- [ ] Improve monitoring page error state with error reason and retry button.
- [ ] Make Health dashboard auto-refresh respect global/user refresh preferences instead of fixed 30s.
- [ ] Improve light-theme compatibility for high-frequency pages: settings, monitoring, traffic, docker, health, status, SFTP browser.

## P5 — Incomplete product surfaces

- [ ] Wire dashboard analytics API into dashboard charts/trends or mark API internal if intentionally unused.
- [ ] Add UI entry for deployment export API or hide/deprecate it cleanly.
- [ ] Clarify backup API behavior: creating records vs actually executing backup task; add task execution or adjust UI wording.
- [ ] Add backup restore API/UI if `backup:restore` is intended to be user-facing.
- [ ] Unify system-health API and Health page behavior.

## P6 — Architecture hardening

- [ ] Move command/deployment SSH execution out of synchronous API path into background tasks/worker model with timeouts, output limits, cancellation, and task status.
- [ ] Strengthen download URL SSRF protections by resolving DNS and blocking private/link-local/metadata targets, similar to webhook URL safeguards.
- [ ] Unify rate limiting store so Redis-backed store is used when configured instead of per-process memory only.
- [ ] Replace remaining shell-string `execSync`/`exec` surfaces with argv-based execution where practical.

## Fresh-audit checkpoint policy

- [ ] After all current checklist items are done, run a new comprehensive audit across backend/API, frontend/UI, production behavior, performance, tests, deployment, and logs.
- [ ] Also run a fresh audit after 6 successful remediation runs even if the backlog is not fully empty, then update this file with new or reprioritized findings.

## Current blockers

- None recorded.

## Last known healthy baseline

- 2026-05-29 comprehensive audit: git clean, `npm run typecheck` passed, `npm run lint` passed, `npm test` passed (160 files / 612 tests), `npm run build` passed, `npm run build:runtime` passed, production services active, `./deploy/smoke-test.sh whrkhldsb.qzz.io vcontrolhub` passed 19/19.
