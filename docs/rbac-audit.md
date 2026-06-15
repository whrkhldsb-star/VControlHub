# VControlHub RBAC Audit Report

> Generated: 2026-06-15T09:59:31.222Z | Permissions: 41 | Roles: 4 | API routes: 79 | Pages: 39 | Drift: 41

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
| `api-no-declared-perm` | low | 22 |
| `api-decl-perm-unused` | medium | 19 |
| `api-route-missing` | low | 0 |
| `page-button-perm-unused` | low | 0 |

## Permissions

| Permission | Granted to roles | Pages using | API routes using | Files |
|---|---|---|---|---|
| `ai:action:approve` | admin | 0 | 0 | 0 |
| `ai:chat` | admin, operator, viewer, storage_manager | 0 | 0 | 2 |
| `ai:manage` | admin, operator | 0 | 0 | 4 |
| `announcement:manage` | admin, operator | 1 | 1 | 5 |
| `api-token:manage` | admin, operator | 1 | 0 | 4 |
| `audit:read` | admin, operator, viewer, storage_manager | 1 | 0 | 2 |
| `backup:create` | admin, operator | 1 | 0 | 6 |
| `backup:read` | admin, operator, viewer, storage_manager | 1 | 0 | 3 |
| `backup:restore` | admin | 1 | 0 | 2 |
| `command:approve` | admin | 1 | 1 | 2 |
| `command:create` | admin, operator | 2 | 1 | 10 |
| `command:execute` | admin, operator | 0 | 1 | 2 |
| `command:read` | admin, operator, viewer, storage_manager | 0 | 0 | 3 |
| `deploy:export` | admin, operator | 1 | 0 | 3 |
| `deploy:manage` | admin | 0 | 0 | 0 |
| `deploy:read` | admin, operator, viewer | 1 | 0 | 2 |
| `deploy:run` | admin, operator | 2 | 0 | 4 |
| `docker:manage` | admin, operator | 3 | 0 | 10 |
| `health:read` | admin, operator, viewer, storage_manager | 2 | 0 | 4 |
| `image:read` | admin | 1 | 0 | 1 |
| `image:write` | admin | 1 | 0 | 1 |
| `media:manage` | admin, operator, storage_manager | 1 | 0 | 3 |
| `notification:manage` | admin, operator | 1 | 0 | 7 |
| `role:manage` | admin | 0 | 3 | 4 |
| `server:read` | admin, operator, viewer, storage_manager | 1 | 0 | 3 |
| `server:ssh` | admin, operator | 1 | 2 | 6 |
| `server:write` | admin, operator | 2 | 1 | 10 |
| `share:create` | admin, operator, storage_manager | 2 | 1 | 4 |
| `share:manage` | admin, operator, storage_manager | 1 | 0 | 2 |
| `share:read` | admin, operator, viewer, storage_manager | 1 | 0 | 2 |
| `snippet:manage` | admin, operator, storage_manager | 1 | 0 | 5 |
| `storage:delete` | admin, storage_manager | 2 | 4 | 8 |
| `storage:manage-node` | admin, storage_manager | 2 | 3 | 8 |
| `storage:read` | admin, operator, viewer, storage_manager | 3 | 2 | 19 |
| `storage:write` | admin, operator, storage_manager | 2 | 4 | 14 |
| `task:read` | admin, operator, viewer, storage_manager | 3 | 0 | 8 |
| `ticket:create` | admin, operator, viewer, storage_manager | 1 | 1 | 2 |
| `ticket:manage` | admin, operator, storage_manager | 2 | 2 | 8 |
| `ticket:read` | admin, operator, viewer, storage_manager | 0 | 0 | 1 |
| `user:manage` | admin | 2 | 0 | 11 |
| `user:read` | admin, operator, viewer, storage_manager | 1 | 3 | 6 |

## Drift details

### `api-no-declared-perm` (low)
API route /src/app/api/ai/conversations/[id] has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/ai/conversations/[id]",
  "file": "src/app/api/ai/conversations/[id]/route.ts",
  "methods": [
    "DELETE",
    "GET",
    "PATCH"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/ai/hosted-actions/[id] has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/ai/hosted-actions/[id]",
  "file": "src/app/api/ai/hosted-actions/[id]/route.ts",
  "methods": [
    "PATCH"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/ai/hosted-actions has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/ai/hosted-actions",
  "file": "src/app/api/ai/hosted-actions/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/ai/models has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/ai/models",
  "file": "src/app/api/ai/models/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/2fa/disable has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/2fa/disable",
  "file": "src/app/api/auth/2fa/disable/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/2fa/enable has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/2fa/enable",
  "file": "src/app/api/auth/2fa/enable/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/2fa/setup has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/2fa/setup",
  "file": "src/app/api/auth/2fa/setup/route.ts",
  "methods": [
    "POST",
    "PUT"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/2fa/verify-login has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/2fa/verify-login",
  "file": "src/app/api/auth/2fa/verify-login/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/signout has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/signout",
  "file": "src/app/api/auth/signout/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/auth/ws-token has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/auth/ws-token",
  "file": "src/app/api/auth/ws-token/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/backups/[id]/restore has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/backups/[id]/restore",
  "file": "src/app/api/backups/[id]/restore/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/dashboard/analytics has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/dashboard/analytics",
  "file": "src/app/api/dashboard/analytics/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/deploy-export has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/deploy-export",
  "file": "src/app/api/deploy-export/route.ts",
  "methods": [
    "GET",
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/deployments/[id]/rollback has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/deployments/[id]/rollback",
  "file": "src/app/api/deployments/[id]/rollback/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/docs/openapi.json has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/docs/openapi.json",
  "file": "src/app/api/docs/openapi.json/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/docs/openapi has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/docs/openapi",
  "file": "src/app/api/docs/openapi/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "share:create" but the route handler doesn't enforce it via requirePermission("share:create") or withApiRoute(..., { permission: "share:create" }, ...)

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "share:create",
  "file": "src/app/api/files/list/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "storage:delete" but the route handler doesn't enforce it via requirePermission("storage:delete") or withApiRoute(..., { permission: "storage:delete" }, ...)

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "storage:delete",
  "file": "src/app/api/files/list/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "storage:write" but the route handler doesn't enforce it via requirePermission("storage:write") or withApiRoute(..., { permission: "storage:write" }, ...)

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "storage:write",
  "file": "src/app/api/files/list/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id]/file declares "user:read" but the route handler doesn't enforce it via requirePermission("user:read") or withApiRoute(..., { permission: "user:read" }, ...)

```json
{
  "path": "/src/app/api/images/[id]/file",
  "declaredPermission": "user:read",
  "file": "src/app/api/images/[id]/file/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id] declares "role:manage" but the route handler doesn't enforce it via requirePermission("role:manage") or withApiRoute(..., { permission: "role:manage" }, ...)

```json
{
  "path": "/src/app/api/images/[id]",
  "declaredPermission": "role:manage",
  "file": "src/app/api/images/[id]/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id] declares "storage:delete" but the route handler doesn't enforce it via requirePermission("storage:delete") or withApiRoute(..., { permission: "storage:delete" }, ...)

```json
{
  "path": "/src/app/api/images/[id]",
  "declaredPermission": "storage:delete",
  "file": "src/app/api/images/[id]/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/batch declares "role:manage" but the route handler doesn't enforce it via requirePermission("role:manage") or withApiRoute(..., { permission: "role:manage" }, ...)

```json
{
  "path": "/src/app/api/images/batch",
  "declaredPermission": "role:manage",
  "file": "src/app/api/images/batch/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/batch declares "storage:delete" but the route handler doesn't enforce it via requirePermission("storage:delete") or withApiRoute(..., { permission: "storage:delete" }, ...)

```json
{
  "path": "/src/app/api/images/batch",
  "declaredPermission": "storage:delete",
  "file": "src/app/api/images/batch/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/list declares "image:read" but the route handler doesn't enforce it via requirePermission("image:read") or withApiRoute(..., { permission: "image:read" }, ...)

```json
{
  "path": "/src/app/api/images/list",
  "declaredPermission": "image:read",
  "file": "src/app/api/images/list/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/list declares "user:read" but the route handler doesn't enforce it via requirePermission("user:read") or withApiRoute(..., { permission: "user:read" }, ...)

```json
{
  "path": "/src/app/api/images/list",
  "declaredPermission": "user:read",
  "file": "src/app/api/images/list/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/stats declares "user:read" but the route handler doesn't enforce it via requirePermission("user:read") or withApiRoute(..., { permission: "user:read" }, ...)

```json
{
  "path": "/src/app/api/images/stats",
  "declaredPermission": "user:read",
  "file": "src/app/api/images/stats/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/upload declares "image:write" but the route handler doesn't enforce it via requirePermission("image:write") or withApiRoute(..., { permission: "image:write" }, ...)

```json
{
  "path": "/src/app/api/images/upload",
  "declaredPermission": "image:write",
  "file": "src/app/api/images/upload/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/upload declares "storage:write" but the route handler doesn't enforce it via requirePermission("storage:write") or withApiRoute(..., { permission: "storage:write" }, ...)

```json
{
  "path": "/src/app/api/images/upload",
  "declaredPermission": "storage:write",
  "file": "src/app/api/images/upload/route.ts"
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/login has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/login",
  "file": "src/app/api/login/route.ts",
  "methods": [
    "POST"
  ]
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/media/[id]/stream declares "storage:read" but the route handler doesn't enforce it via requirePermission("storage:read") or withApiRoute(..., { permission: "storage:read" }, ...)

```json
{
  "path": "/src/app/api/media/[id]/stream",
  "declaredPermission": "storage:read",
  "file": "src/app/api/media/[id]/stream/route.ts"
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/monitoring/stats has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/monitoring/stats",
  "file": "src/app/api/monitoring/stats/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/preferences has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/preferences",
  "file": "src/app/api/preferences/route.ts",
  "methods": [
    "GET",
    "PUT"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/servers/[id]/file-proxy has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/servers/[id]/file-proxy",
  "file": "src/app/api/servers/[id]/file-proxy/route.ts",
  "methods": [
    "DELETE",
    "GET",
    "POST"
  ]
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/share/[token] has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/share/[token]",
  "file": "src/app/api/share/[token]/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/snippets declares "role:manage" but the route handler doesn't enforce it via requirePermission("role:manage") or withApiRoute(..., { permission: "role:manage" }, ...)

```json
{
  "path": "/src/app/api/snippets",
  "declaredPermission": "role:manage",
  "file": "src/app/api/snippets/route.ts"
}
```

### `api-no-declared-perm` (low)
API route /src/app/api/status has no declaredPermissions (could be intentionally public)

```json
{
  "path": "/src/app/api/status",
  "file": "src/app/api/status/route.ts",
  "methods": [
    "GET"
  ]
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:delete" but the route handler doesn't enforce it via requirePermission("storage:delete") or withApiRoute(..., { permission: "storage:delete" }, ...)

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:delete",
  "file": "src/app/api/storage/sftp-ops/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:read" but the route handler doesn't enforce it via requirePermission("storage:read") or withApiRoute(..., { permission: "storage:read" }, ...)

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:read",
  "file": "src/app/api/storage/sftp-ops/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:write" but the route handler doesn't enforce it via requirePermission("storage:write") or withApiRoute(..., { permission: "storage:write" }, ...)

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:write",
  "file": "src/app/api/storage/sftp-ops/route.ts"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/tickets declares "ticket:create" but the route handler doesn't enforce it via requirePermission("ticket:create") or withApiRoute(..., { permission: "ticket:create" }, ...)

```json
{
  "path": "/src/app/api/tickets",
  "declaredPermission": "ticket:create",
  "file": "src/app/api/tickets/route.ts"
}
```

