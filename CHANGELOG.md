# Changelog

All notable changes to VControlHub are documented here. Versions follow Semantic Versioning.

## [Unreleased]

### Added

- Windows Agent support: Windows nodes can now switch to Node Agent mode and connect a PowerShell agent (Windows 10 / Server 2016+) for monitoring metrics and command execution. The agent speaks the same authenticated poll protocol as the Linux Python agent, runs as a SYSTEM scheduled task (`VControlHubAgent`) installed via a one-time elevated PowerShell one-liner (`prepareWindowsAgentInstall` + `GET /api/agent/v1/bootstrap`), reports metrics in the shared `===SECTION===` format, executes jobs through `cmd /c chcp 65001` (UTF-8), heartbeats long jobs, and clamps 32-bit exit codes to the protocol's 0–255 range. See `docs/windows-agent.md`.
- Windows node cards: agent status chip, install-command panel with clipboard copy, and realtime probing via the agent metrics channel once connected.
- `docs/windows-agent.md` — Windows agent architecture, install/uninstall flow, and security properties.
- Windows support for development, build, and production run: platform-aware relay download temp dir (`%TEMP%`), file-version blob root (`%PROGRAMDATA%\VControlHub`), and hub-host Docker endpoint (named pipe / `DOCKER_HOST` with `unix://`、`npipe://`、`tcp://` parsing); Windows bsdtar exclude handling for local archive streaming.
- Hub-host monitoring and traffic stats on Windows: CPU via `os.cpus()` window diff, per-process top list and TCP connection count via PowerShell/`netstat`, interface counters via `Get-NetAdapterStatistics` (shared sampler with short cache, also used by the traffic route).
- `docs/windows-development.md` — Windows environment setup, production run, and per-feature platform boundaries.
- CI `test-windows` job (windows-latest): typecheck + lint + unit tests + build, guarding cross-platform regressions.
- Cross-platform CLI backup/restore entry points: `npm run backup` / `npm run restore` wrap the Node runners (`scripts/backup.mjs` / `scripts/restore.mjs`, sharing `scripts/lib/backup-common.mjs`); artifact formats, exit codes, and log prefixes match the bash scripts, so Windows and Linux share one command surface.
- `src/lib/ssh/server-target.ts` — the single "load server → require enabled → build SSH params" step with typed errors and canonical `backend.ssh.*` copy (zh/en), plus a credential-free variant for scope descriptors.

### Changed

- Naming unification: package name is `vcontrolhub`; systemd unit templates renamed `whrkhldsb-*.service.example` → `vcontrolhub-*.service.example` (the installer's legacy-name fallback is removed); CI database name unified to `vcontrolhub_ci` (matching `vcontrolhub_release` in the release workflow); `.env.example` defaults (`APP_NAME`/`APP_SLUG`/`PG_DB_*`), `scripts/ci-local.sh`, the rclone-alist unit description and stale doc references follow the same slug.
- Agent capability declarations now list `["metrics","command"]` on both platforms — the previous `"file"` entry was a placeholder with no implementation behind it.
- API error copy is fully translated: the last hard-coded English messages (VPS backup deletion/path containment, app-source catalog fetch, archive exclusion validation) moved to zh/en service translations, and the api-copy audit baseline is now zero findings.
- All `tsx`-driven npm scripts now auto-load `.env` (`--env-file-if-exists=.env`), fixing `npm run db:seed` & co. on fresh checkouts on every platform.
- Archive listing (`/api/files/archive-list`) parses both GNU tar and bsdtar `-tv` output, and reads zip archives via bsdtar on Windows (no `unzip` needed); `.gz` extraction now decompresses with Node `zlib` instead of the `gunzip` binary.
- Route catalog / RBAC audit / verification scripts normalize path separators, producing identical output on every OS (previously the catalog generated zero routes on Windows, which broke `next build`); rbac-audit output lists are sorted for deterministic diffs.
- `verify:deploy-assets` runs through a cross-platform wrapper (explicit skip on Windows) so `npm run verify` completes everywhere.
- One platform abstraction: `src/lib/runtime/platform-paths.ts` now also exports `NULL_DEVICE`, `findExecutable`, `hubHostDockerSocketMount()`, `tempRoot()` and the live-read `isWindows()`; a parallel draft module was merged in and deleted.
- Password-auth SSH commands on Windows run over the bundled ssh2 client in-process (Windows ships no `sshpass`); bounded output, timeout/cancel codes, and host-key pinning match the sshpass transport, and tests can pin either transport explicitly.
- Backup/restore argv planning is spec-driven per platform (`backup/platform-runner.ts`); backup drills verify gzip integrity and PostgreSQL format in-process via Node `zlib` instead of `gzip -t` / `head` shell pipelines. aria2 binary resolution searches PATH plus platform install roots (with `ARIA2_BIN` override) instead of hard-coded `/usr/bin`.
- One shell-quoting implementation: six local `shellQuote` copies (three textual variants of a shell-injection guard) now import `@/lib/shell-quote`.
- One SSH server loader: quick-service docker, docker compose, and SFTP previously each inlined the lookup with three different failure shapes (422/400/500) for the same condition; all resolve through `server-target.ts` with typed errors.
- API-facing raw `Error` throws converted to typed errors — VPS backup record deletion (404/409/400 instead of 500), quick-service remote docker and catalog adapters, archive exclusion validation — so clients receive real status codes and messages.
- Frontend consistency: the image-bed page rides the global toast system (its page-local FloatingToast with private state/timer is deleted); sparkline and diff-review colors resolve from design tokens (zero raw palette classes remain); Spinner/Notice can no longer fall back to English labels in the zh locale; seven pure presentational components dropped needless `"use client"`; inline loading standardized on `InlineLoading`.

### Fixed

- Windows nodes never fall into the Linux-only SSH paths anymore: `/api/servers/monitor` returns an explicit agent-offline (AGENT mode) or Linux-only (DIRECT mode) error instead of surfacing `buildSshParamsFromServer`'s rejection as a "connection failed" message, and batch-command targets on Windows fail with "no SSH fallback channel" instead of a misleading missing-password/host-key error when the agent goes stale between approval and execution.
- `/api/agent/v1/bootstrap` is registered in the RBAC audit's intentional public list (per-server bearer token auth, like `/api/agent/v1/poll`) and counted in the OpenAPI spec test; the stale "Windows rejects AGENT mode" schema test now asserts the new accepted-by-design behavior.
- README auto-metrics counted 0 pages / 0 API route files on Windows: the script's path predicates only matched `/` separators; both separators are now matched (55 pages / 185 routes regenerate identically on every OS).
- Pinned host-key fingerprints silently read as `null` in the quick-service docker and docker-compose remote loaders (their prisma projections never selected `hostKeySha256`); the unified loader selects it, so host-key pinning works for those paths.
- VPS backup download paths on Windows: containment used POSIX string prefixes against native `path.resolve` results and always reported "escapes storage root"; now uses `path.relative`.
- Windows path handling across unit tests (platform-native expectations); Linux installer/restore-script tests skip explicitly on Windows instead of failing with `spawn bash ENOENT`.

## [0.1.0] - 2026-08-06

### Added

- VPS, SSH terminal, storage, backup, deployment, monitoring, alerting, ticket, AI, and team-management workflows.
- One-command lifecycle installer with install, update, health-check, backup, and complete uninstall actions.
- PostgreSQL migrations, independent durable workers, RBAC, audit logging, 2FA, API tokens, and bilingual UI.

### Changed

- Split browser, server-page, and backend-service translations to reduce browser and long-running process bundles.
- Hardened tenant boundaries, SSH onboarding, backup recovery, deployment idempotency, and release packaging.

### Security

- Added CSRF protection, rate limits, encrypted credentials, host-key pinning support, safe path handling, and dependency audit gates.

[0.1.0]: https://github.com/whrkhldsb-star/VControlHub/releases/tag/v0.1.0
