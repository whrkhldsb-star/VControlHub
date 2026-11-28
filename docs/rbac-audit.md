# VControlHub RBAC Audit Report

> Generated: 2026-11-28T08:13:50.770Z | Permissions: 54 | Roles: 4 | API routes: 201 | Pages: 59 | Drift: 0

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
| `ai:action:approve` | admin | 0 | 0 | 3 |
| `ai:action:auto` | admin, operator | 1 | 0 | 1 |
| `ai:action:full-auto` | admin | 1 | 0 | 1 |
| `ai:chat` | admin, operator | 3 | 0 | 33 |
| `ai:manage` | admin, operator | 3 | 1 | 19 |
| `ai:ops:autonomous` | admin | 1 | 2 | 3 |
| `ai:ops:manage` | admin | 1 | 1 | 11 |
| `ai:ops:read` | admin | 1 | 0 | 9 |
| `announcement:manage` | admin | 0 | 1 | 7 |
| `api-token:manage` | admin, operator | 0 | 0 | 5 |
| `audit:read` | admin, operator, viewer, storage_manager | 0 | 1 | 9 |
| `backup:create` | admin | 1 | 0 | 21 |
| `backup:read` | admin | 1 | 0 | 12 |
| `backup:restore` | admin | 1 | 0 | 5 |
| `command:approve` | admin | 5 | 6 | 31 |
| `command:create` | admin, operator | 6 | 0 | 26 |
| `command:execute` | admin, operator | 4 | 2 | 15 |
| `command:read` | admin, operator, viewer, storage_manager | 7 | 2 | 36 |
| `cost:manage` | admin, operator | 1 | 0 | 25 |
| `cost:read` | admin, operator, viewer | 1 | 0 | 16 |
| `deploy:export` | admin, operator | 1 | 0 | 7 |
| `deploy:manage` | admin | 0 | 1 | 1 |
| `deploy:read` | admin, operator, viewer | 3 | 0 | 6 |
| `deploy:run` | admin, operator | 2 | 0 | 5 |
| `docker:manage` | admin, operator | 0 | 3 | 27 |
| `health:read` | admin, operator, viewer, storage_manager | 1 | 2 | 16 |
| `image:read` | admin | 1 | 2 | 8 |
| `image:write` | admin | 1 | 0 | 10 |
| `media:manage` | admin, operator, storage_manager | 2 | 5 | 14 |
| `notification:manage` | admin, operator | 3 | 0 | 17 |
| `playbook:manage` | admin | 1 | 0 | 9 |
| `playbook:read` | admin, operator | 3 | 1 | 10 |
| `playbook:run` | admin, operator | 1 | 0 | 8 |
| `role:manage` | admin | 0 | 4 | 4 |
| `server:read` | admin, operator, viewer, storage_manager | 16 | 5 | 57 |
| `server:sftp:unrestricted` | admin | 0 | 3 | 6 |
| `server:ssh` | admin, operator | 1 | 2 | 41 |
| `server:write` | admin, operator | 1 | 1 | 23 |
| `share:create` | admin, operator, storage_manager | 1 | 0 | 3 |
| `share:manage` | admin, operator, storage_manager | 1 | 0 | 5 |
| `share:read` | admin, operator, viewer, storage_manager | 0 | 0 | 4 |
| `snippet:manage` | admin, operator, storage_manager | 3 | 0 | 11 |
| `storage:delete` | admin, storage_manager | 1 | 2 | 10 |
| `storage:manage-node` | admin, storage_manager | 2 | 8 | 33 |
| `storage:read` | admin, operator, viewer, storage_manager | 3 | 2 | 63 |
| `storage:write` | admin, operator, storage_manager | 2 | 6 | 51 |
| `task:read` | admin, operator, viewer, storage_manager | 3 | 0 | 10 |
| `team:manage` | admin | 3 | 7 | 48 |
| `team:read` | admin, operator, viewer, storage_manager | 0 | 0 | 2 |
| `ticket:create` | admin, operator, viewer, storage_manager | 1 | 0 | 4 |
| `ticket:manage` | admin, operator, storage_manager | 2 | 3 | 37 |
| `ticket:read` | admin, operator, viewer, storage_manager | 0 | 1 | 9 |
| `user:manage` | admin | 5 | 0 | 30 |
| `user:read` | admin, operator, viewer, storage_manager | 0 | 0 | 2 |

## ✅ No drift detected
