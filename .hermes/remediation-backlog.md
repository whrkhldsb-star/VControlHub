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

- [x] 2026-05-29 — Split ticket permissions so normal authenticated users can create tickets without broad `ticket:manage`; added `ticket:create` and `ticket:read` alongside manager-only `ticket:manage`. Verification: targeted ticket/RBAC/seed Vitest 26/26, typecheck, lint, build, runtime build, seed, restart, production smoke 19/19 passed. Commit: c729ce5.
- [x] 2026-05-29 — Make manager/admin ticket list return all tickets; normal users only see created/assigned tickets via service-layer `includeAll`. Verification: route/service regressions passed.
- [x] 2026-05-29 — Keep ticket detail/comment access consistent for creator, assignee, and manager/admin; comments still require ticket participant or `ticket:manage`, not broad read-only access. Verification: id-route and list-route regressions passed.
- [x] 2026-05-29 — Update RBAC seed/tests for `ticket:create`, `ticket:read`, `ticket:manage`. Verification: `prisma/__tests__/seed.test.ts` and RBAC tests passed, `npx prisma db seed` ran successfully.
- [x] 2026-05-29 — Add regression tests for create/list/comment/update paths. Verification: `src/app/api/tickets/__tests__/route.test.ts`, `id-route.test.ts`, and `src/lib/ticket/service.test.ts` passed.

## P2 — Storage and file-size safety

- [x] 2026-05-30 — Add SFTP read/preview size limit in `src/app/api/storage/sftp-ops/route.ts`; large files now return HTTP 413 with a clear download-oriented error before remote read when indexed size is known, and after read as a fallback when index size is unknown. Verification: storage route regressions, neighboring storage tests, typecheck, lint, build, runtime build, production restart, smoke 19/19, route probes passed.
- [x] 2026-05-30 — Add local upload pre-read size checks using `File.size` before `arrayBuffer()`; uploads over 100 MB now return HTTP 413 before storage lookup, access checks, disk writes, or SFTP writes. Verification: regression proves `arrayBuffer()` is not called for oversized declared files; storage route regressions, typecheck, lint, build, runtime build, production smoke passed.
- [x] 2026-05-30 — Harden `src/lib/storage/access-control.ts` no-grant behavior to default deny for non-storage-managers; only `storage:manage-node` remains a break-glass bypass, with an explicit `VCONTROLHUB_STORAGE_GRANT_FALLBACK=true` compatibility flag for temporary legacy deployments. Verification: access-control regression proves old role-only fallback now fails, targeted storage tests 27/27 passed, typecheck, lint, build, runtime build, production restart, smoke 19/19, route probes returned 401 without 500.
- [x] 2026-05-30 — Add tests for over-limit SFTP read and over-limit local upload. Verification: `npx vitest run src/app/api/storage/sftp-ops/__tests__/route.test.ts src/app/api/storage/local/__tests__/route.test.ts src/lib/storage/__tests__/access-control.test.ts src/lib/storage/__tests__/sftp-sync.test.ts` passed 26/26.

## P3 — Quick Services permission and task robustness

- [x] 2026-05-30 — Replace Quick Services `user:manage` permission with `docker:manage` consistently in routes/UI/RBAC so Docker operators can manage Quick Services without broad user-management rights. Verification: Quick Services route regression proves `docker:manage` is used and `user:manage` is not; RBAC regression proves operators have Docker/Quick Services management without user management; targeted tests, typecheck, lint, build, runtime build, seed, production restart, smoke 19/19, and route probe passed. Commit: a36d768.
- [x] 2026-05-30 — Add seed/test synchronization for Quick Services permission labeling by expanding `docker:manage` labels to cover Quick Services. Verification: `prisma/__tests__/seed.test.ts` included in targeted run and `npx prisma db seed` executed successfully.
- [x] 2026-05-30 — Add per-process Quick Services lifecycle task lock and installing-state guard to prevent concurrent install/start/stop/uninstall operations from racing on the same slug. Verification: service regressions prove concurrent same-slug operations fail before DB/Docker side effects and uninstall refuses an installing service; targeted Quick Services/RBAC/seed Vitest 31/31, typecheck, lint, build, runtime build, production restart, smoke 19/19, route probe passed. Commit: 7b3c3ec.
- [x] 2026-05-30 — Improve Quick Services install failure visibility/logging and cleanup state: failed async Docker installs now record stderr/stdout-preferred Docker messages, mark the service `error`, and best-effort remove partial containers while preserving cleanup-failure context for operators. Verification: Quick Services service/API/client regressions 27/27, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/api/quick-services` and `/quick-services` probes returned 401/307 without 500. Commit: c729ce5.

## P4 — UI availability and polish

- [x] 2026-05-30 — Replace mobile nav index references in `src/components/nav-items.tsx` with stable href-based selection and regression coverage for the intended bottom items (`/`, `/servers`, `/traffic`, `/files`, `/settings`). Verification: targeted mobile-nav/component tests, full Vitest suite 163 files / 640 tests, typecheck, lint, build, runtime build, production restart, smoke 19/19, route probes passed. Commit: 3bc6bbf.
- [x] 2026-05-30 — Replace `window.location.reload()` in announcement and ticket creation forms with App Router `router.refresh()` so successful submissions update server-rendered lists without a full page reload. Verification: new form regressions prove `router.refresh()` is called after successful CSRF POST; targeted tests, full Vitest suite, typecheck, lint, build, runtime build, production restart, smoke 19/19 passed. Commit: 3bc6bbf.
- [x] 2026-05-30 — Replace remaining `window.location.reload()` in two-factor settings with App Router `router.refresh()` so enable/disable refreshes server-rendered account state without a full page reload. Verification: two-factor/settings regressions 8/8, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/api/status` 200, `/settings` 307, 2FA setup unauth probe 401, recent logs clean. Commit: a095185.
- [x] 2026-05-30 — Add an actionable SFTP browser empty state when no SFTP nodes exist, and mount the SFTP remote browser on the Files page instead of leaving the remote browsing surface invisible. The empty state links to VPS onboarding and the storage-node manager anchor. Verification: SFTP/page/files-browser regressions 16/16, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/files` 307 and unauth SFTP API 401 without 500, recent logs clean. Commit: 3917ddc.
- [x] 2026-05-30 — Improve monitoring page error state with the backend/fetch error reason, a retry button for initial load failures, stale-data preservation plus an inline warning for refresh failures, and disabled loading labels during in-flight refresh/retry. Verification: monitoring page regressions 2/2, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/monitoring` 307 and `/api/monitoring/stats` 401 without 500, recent logs clean. Commit: b70edc3.
- [x] 2026-05-30 — Make Health dashboard auto-refresh respect global/user refresh preferences instead of fixed 30s; saved 60s/manual preferences now control the timer and the UI shows the active cadence/disabled state. Verification: health dashboard + refresh-preference regressions 10/10, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/health` 307, `/api/health` 401, `/api/status` 200, recent logs clean. Commit: efe1c4a.
- [x] 2026-05-30 — Improve light-theme compatibility for high-frequency monitoring/health/status surfaces by extending the global light-mode compatibility layer to cover warning/error/success/info tint backgrounds, borders, and high-contrast status text used by monitoring cards and operator alerts. Verification: monitoring CSS regression 3/3, typecheck, lint, build, runtime build, production restart, smoke 19/19, `/monitoring` 307, unauth monitoring API 401, `/api/status` 200, recent logs clean. Commit: 1e4726a.

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

- [x] 2026-05-30 — Fresh audit checkpoint after 7 successful remediation runs: git clean at start, production services active, smoke 19/19 passed, key authenticated APIs returned 401 instead of 500, recent logs contained no new error/warn entries, full quality gate passed (`typecheck`, `lint`, full Vitest 163 files / 640 tests, `build`, `build:runtime`). Backlog was refreshed; remaining priority is functional availability for Quick Services failure cleanup, two-factor settings no-reload UX, storage/monitoring/health usability, incomplete dashboard/deploy/backup surfaces, and architecture hardening.
- [ ] After all current checklist items are done, run a new comprehensive audit across backend/API, frontend/UI, production behavior, performance, tests, deployment, and logs.
- [ ] Also run a fresh audit after 6 successful remediation runs even if the backlog is not fully empty, then update this file with new or reprioritized findings.

## Current blockers

- None recorded.

## Last known healthy baseline

- 2026-05-29 comprehensive audit: git clean, `npm run typecheck` passed, `npm run lint` passed, `npm test` passed (160 files / 612 tests), `npm run build` passed, `npm run build:runtime` passed, production services active, `./deploy/smoke-test.sh whrkhldsb.qzz.io vcontrolhub` passed 19/19.
