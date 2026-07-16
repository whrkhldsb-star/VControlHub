# VControlHub RBAC Audit Report

> Generated: 2026-07-16T02:46:05.422Z | Permissions: 54 | Roles: 4 | API routes: 138 | Pages: 47 | Drift: 0

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
| `ai:action:approve` | admin | 0 | 0 | 0 |
| `ai:chat` | admin, operator, viewer, storage_manager | 0 | 0 | 6 |
| `ai:manage` | admin, operator | 0 | 0 | 12 |
| `ai:ops:autonomous` | admin | 1 | 1 | 2 |
| `ai:ops:manage` | admin | 1 | 0 | 9 |
| `ai:ops:read` | admin, operator, viewer | 0 | 0 | 8 |
| `announcement:manage` | admin, operator | 1 | 1 | 8 |
| `api-token:manage` | admin, operator | 1 | 0 | 6 |
| `audit:read` | admin, operator, viewer, storage_manager | 1 | 1 | 8 |
| `backup:create` | admin, operator | 1 | 0 | 19 |
| `backup:read` | admin, operator, viewer, storage_manager | 1 | 0 | 9 |
| `backup:restore` | admin | 1 | 0 | 5 |
| `command:approve` | admin | 1 | 1 | 3 |
| `command:create` | admin, operator | 2 | 1 | 17 |
| `command:execute` | admin, operator | 1 | 1 | 4 |
| `command:read` | admin, operator, viewer, storage_manager | 0 | 0 | 6 |
| `cost:manage` | admin, operator | 1 | 0 | 17 |
| `cost:read` | admin, operator, viewer | 1 | 0 | 11 |
| `deploy:export` | admin, operator | 1 | 0 | 7 |
| `deploy:manage` | admin | 0 | 0 | 0 |
| `deploy:read` | admin, operator, viewer | 1 | 0 | 3 |
| `deploy:run` | admin, operator | 2 | 0 | 5 |
| `docker:manage` | admin, operator | 2 | 1 | 25 |
| `health:read` | admin, operator, viewer, storage_manager | 1 | 1 | 7 |
| `image:read` | admin | 0 | 2 | 3 |
| `image:write` | admin | 1 | 1 | 3 |
| `media:manage` | admin, operator, storage_manager | 1 | 1 | 6 |
| `notification:manage` | admin, operator | 1 | 0 | 12 |
| `playbook:manage` | admin | 1 | 0 | 7 |
| `playbook:read` | admin, operator | 1 | 1 | 8 |
| `playbook:run` | admin, operator | 1 | 0 | 5 |
| `role:manage` | admin | 0 | 3 | 10 |
| `server:read` | admin, operator, viewer, storage_manager | 0 | 5 | 15 |
| `server:sftp:unrestricted` | admin | 0 | 0 | 0 |
| `server:ssh` | admin, operator | 1 | 3 | 19 |
| `server:write` | admin, operator | 2 | 5 | 15 |
| `share:create` | admin, operator, storage_manager | 2 | 1 | 5 |
| `share:manage` | admin, operator, storage_manager | 1 | 0 | 5 |
| `share:read` | admin, operator, viewer, storage_manager | 1 | 0 | 5 |
| `snippet:manage` | admin, operator, storage_manager | 0 | 0 | 8 |
| `storage:delete` | admin, storage_manager | 2 | 4 | 8 |
| `storage:manage-node` | admin, storage_manager | 2 | 3 | 10 |
| `storage:read` | admin, operator, viewer, storage_manager | 3 | 1 | 43 |
| `storage:write` | admin, operator, storage_manager | 2 | 4 | 38 |
| `task:read` | admin, operator, viewer, storage_manager | 3 | 0 | 13 |
| `team:create` | admin, operator | 0 | 0 | 2 |
| `team:manage` | admin | 0 | 1 | 1 |
| `team:member:manage` | admin, operator | 0 | 0 | 0 |
| `team:read` | admin, operator, viewer, storage_manager | 0 | 0 | 0 |
| `ticket:create` | admin, operator, viewer, storage_manager | 1 | 1 | 2 |
| `ticket:manage` | admin, operator, storage_manager | 2 | 2 | 12 |
| `ticket:read` | admin, operator, viewer, storage_manager | 0 | 0 | 2 |
| `user:manage` | admin | 2 | 0 | 24 |
| `user:read` | admin, operator, viewer, storage_manager | 1 | 2 | 9 |

## ✅ No drift detected
