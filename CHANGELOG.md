# Changelog

All notable changes to VControlHub are documented here. Versions follow Semantic Versioning.

## [Unreleased]

### Added

- Windows support for development, build, and production run: platform-aware relay download temp dir (`%TEMP%`), file-version blob root (`%PROGRAMDATA%\VControlHub`), and hub-host Docker endpoint (named pipe / `DOCKER_HOST` with `unix://`、`npipe://`、`tcp://` parsing); Windows bsdtar exclude handling for local archive streaming.
- Hub-host monitoring and traffic stats on Windows: CPU via `os.cpus()` window diff, per-process top list and TCP connection count via PowerShell/`netstat`, interface counters via `Get-NetAdapterStatistics` (shared sampler with short cache, also used by the traffic route).
- `docs/windows-development.md` — Windows environment setup, production run, and per-feature platform boundaries.
- CI `test-windows` job (windows-latest): typecheck + lint + unit tests + build, guarding cross-platform regressions.

### Changed

- All `tsx`-driven npm scripts now auto-load `.env` (`--env-file-if-exists=.env`), fixing `npm run db:seed` & co. on fresh checkouts on every platform.
- Archive listing (`/api/files/archive-list`) parses both GNU tar and bsdtar `-tv` output, and reads zip archives via bsdtar on Windows (no `unzip` needed); `.gz` extraction now decompresses with Node `zlib` instead of the `gunzip` binary.
- Route catalog / RBAC audit / verification scripts normalize path separators, producing identical output on every OS (previously the catalog generated zero routes on Windows, which broke `next build`); rbac-audit output lists are sorted for deterministic diffs.
- `verify:deploy-assets` runs through a cross-platform wrapper (explicit skip on Windows) so `npm run verify` completes everywhere.

### Fixed

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
