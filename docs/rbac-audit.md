# VControlHub RBAC Audit Report

> Generated: 2026-06-15T11:03:32.783Z | Permissions: 41 | Roles: 4 | API routes: 86 | Pages: 41 | Drift: 0

This report cross-references four RBAC sources of truth:
1. `src/lib/auth/rbac.ts` — `PERMISSIONS` tuple + `DEFAULT_ROLE_PERMISSIONS` map
2. `docs/route-catalog.json` — per-API-route and per-page `declaredPermissions`
3. `src/app/**/*.{ts,tsx}` — actual `sessionHasPermission(...)` and `requirePermission(...)` call sites
4. Page-level permission gating (variable assignment + downstream usage)

## Drift by category

| Code | Severity | Count |
|---|---|---|
| `perm-not-in-list` | low | 0 |
| `perm-without-role` | low | 0 |
| `role-grants-unknown` | low | 0 |
| `api-no-declared-perm` | low | 0 |
| `api-decl-perm-unused` | low | 0 |
| `api-route-missing` | low | 0 |
| `page-button-perm-unused` | low | 0 |

## Permissions

| Permission | Granted to roles | Pages using | API routes using | Files |
|---|---|---|---|---|
| `ai:action:approve` | admin | 0 | 0 | 1 |
| `ai:chat` | admin, operator, viewer, storage_manager | 0 | 0 | 2 |
| `ai:manage` | admin, operator | 0 | 0 | 4 |
| `announcement:manage` | admin, operator | 1 | 1 | 7 |
| `api-token:manage` | admin, operator | 1 | 0 | 5 |
| `audit:read` | admin, operator, viewer, storage_manager | 1 | 0 | 3 |
| `backup:create` | admin, operator | 1 | 0 | 8 |
| `backup:read` | admin, operator, viewer, storage_manager | 1 | 0 | 4 |
| `backup:restore` | admin | 1 | 0 | 3 |
| `command:approve` | admin | 1 | 1 | 3 |
| `command:create` | admin, operator | 2 | 1 | 12 |
| `command:execute` | admin, operator | 0 | 1 | 3 |
| `command:read` | admin, operator, viewer, storage_manager | 0 | 0 | 3 |
| `deploy:export` | admin, operator | 1 | 0 | 4 |
| `deploy:manage` | admin | 0 | 0 | 0 |
| `deploy:read` | admin, operator, viewer | 1 | 0 | 3 |
| `deploy:run` | admin, operator | 2 | 0 | 6 |
| `docker:manage` | admin, operator | 3 | 0 | 13 |
| `health:read` | admin, operator, viewer, storage_manager | 2 | 0 | 7 |
| `image:read` | admin | 1 | 0 | 3 |
| `image:write` | admin | 1 | 0 | 3 |
| `media:manage` | admin, operator, storage_manager | 1 | 0 | 4 |
| `notification:manage` | admin, operator | 1 | 0 | 8 |
| `role:manage` | admin | 0 | 3 | 7 |
| `server:read` | admin, operator, viewer, storage_manager | 1 | 0 | 4 |
| `server:ssh` | admin, operator | 1 | 2 | 9 |
| `server:write` | admin, operator | 2 | 1 | 12 |
| `share:create` | admin, operator, storage_manager | 2 | 1 | 7 |
| `share:manage` | admin, operator, storage_manager | 1 | 0 | 3 |
| `share:read` | admin, operator, viewer, storage_manager | 1 | 0 | 3 |
| `snippet:manage` | admin, operator, storage_manager | 1 | 0 | 6 |
| `storage:delete` | admin, storage_manager | 2 | 4 | 13 |
| `storage:manage-node` | admin, storage_manager | 2 | 3 | 12 |
| `storage:read` | admin, operator, viewer, storage_manager | 3 | 2 | 24 |
| `storage:write` | admin, operator, storage_manager | 2 | 4 | 18 |
| `task:read` | admin, operator, viewer, storage_manager | 3 | 0 | 11 |
| `ticket:create` | admin, operator, viewer, storage_manager | 1 | 1 | 4 |
| `ticket:manage` | admin, operator, storage_manager | 2 | 2 | 12 |
| `ticket:read` | admin, operator, viewer, storage_manager | 0 | 0 | 1 |
| `user:manage` | admin | 2 | 0 | 13 |
| `user:read` | admin, operator, viewer, storage_manager | 1 | 3 | 10 |

## ✅ No drift detected
