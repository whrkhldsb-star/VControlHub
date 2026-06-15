# VControlHub RBAC Audit Report

> Generated: 2026-06-15T09:27:02.723Z | Permissions: 41 | Roles: 4 | API routes: 79 | Pages: 39 | Drift: 103

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
| `api-decl-perm-unused` | medium | 81 |
| `api-route-missing` | low | 0 |
| `page-button-perm-unused` | low | 0 |

## Permissions

| Permission | Granted to roles | Pages using | API routes using | Files |
|---|---|---|---|---|
| `ai:action:approve` | admin | 0 | 0 | 0 |
| `ai:chat` | admin, operator, viewer, storage_manager | 0 | 0 | 0 |
| `ai:manage` | admin, operator | 0 | 0 | 0 |
| `announcement:manage` | admin, operator | 1 | 1 | 2 |
| `api-token:manage` | admin, operator | 0 | 0 | 0 |
| `audit:read` | admin, operator, viewer, storage_manager | 1 | 0 | 1 |
| `backup:create` | admin, operator | 1 | 0 | 2 |
| `backup:read` | admin, operator, viewer, storage_manager | 1 | 0 | 1 |
| `backup:restore` | admin | 1 | 0 | 1 |
| `command:approve` | admin | 1 | 1 | 2 |
| `command:create` | admin, operator | 2 | 1 | 3 |
| `command:execute` | admin, operator | 0 | 1 | 1 |
| `command:read` | admin, operator, viewer, storage_manager | 0 | 0 | 0 |
| `deploy:export` | admin, operator | 1 | 0 | 1 |
| `deploy:manage` | admin | 0 | 0 | 0 |
| `deploy:read` | admin, operator, viewer | 1 | 0 | 1 |
| `deploy:run` | admin, operator | 2 | 0 | 2 |
| `docker:manage` | admin, operator | 3 | 0 | 3 |
| `health:read` | admin, operator, viewer, storage_manager | 2 | 0 | 2 |
| `image:read` | admin | 1 | 0 | 1 |
| `image:write` | admin | 1 | 0 | 1 |
| `media:manage` | admin, operator, storage_manager | 1 | 0 | 1 |
| `notification:manage` | admin, operator | 1 | 0 | 1 |
| `role:manage` | admin | 0 | 3 | 4 |
| `server:read` | admin, operator, viewer, storage_manager | 1 | 0 | 1 |
| `server:ssh` | admin, operator | 1 | 2 | 5 |
| `server:write` | admin, operator | 2 | 1 | 10 |
| `share:create` | admin, operator, storage_manager | 2 | 1 | 3 |
| `share:manage` | admin, operator, storage_manager | 1 | 0 | 1 |
| `share:read` | admin, operator, viewer, storage_manager | 1 | 0 | 1 |
| `snippet:manage` | admin, operator, storage_manager | 1 | 0 | 1 |
| `storage:delete` | admin, storage_manager | 2 | 4 | 8 |
| `storage:manage-node` | admin, storage_manager | 2 | 3 | 8 |
| `storage:read` | admin, operator, viewer, storage_manager | 3 | 2 | 5 |
| `storage:write` | admin, operator, storage_manager | 2 | 4 | 7 |
| `task:read` | admin, operator, viewer, storage_manager | 3 | 0 | 3 |
| `ticket:create` | admin, operator, viewer, storage_manager | 1 | 1 | 2 |
| `ticket:manage` | admin, operator, storage_manager | 2 | 2 | 6 |
| `ticket:read` | admin, operator, viewer, storage_manager | 0 | 0 | 0 |
| `user:manage` | admin | 2 | 0 | 2 |
| `user:read` | admin, operator, viewer, storage_manager | 1 | 3 | 4 |

## Drift details

### `api-decl-perm-unused` (medium)
API route /src/app/api/ai/chat declares "ai:chat" but the route handler doesn't call requirePermission("ai:chat")

```json
{
  "path": "/src/app/api/ai/chat",
  "declaredPermission": "ai:chat"
}
```

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

### `api-decl-perm-unused` (medium)
API route /src/app/api/ai/conversations declares "ai:chat" but the route handler doesn't call requirePermission("ai:chat")

```json
{
  "path": "/src/app/api/ai/conversations",
  "declaredPermission": "ai:chat"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/ai/models/probe declares "ai:manage" but the route handler doesn't call requirePermission("ai:manage")

```json
{
  "path": "/src/app/api/ai/models/probe",
  "declaredPermission": "ai:manage"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/ai/providers/[id] declares "ai:manage" but the route handler doesn't call requirePermission("ai:manage")

```json
{
  "path": "/src/app/api/ai/providers/[id]",
  "declaredPermission": "ai:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/ai/providers declares "ai:manage" but the route handler doesn't call requirePermission("ai:manage")

```json
{
  "path": "/src/app/api/ai/providers",
  "declaredPermission": "ai:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/alert-rules declares "notification:manage" but the route handler doesn't call requirePermission("notification:manage")

```json
{
  "path": "/src/app/api/alert-rules",
  "declaredPermission": "notification:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/announcements declares "announcement:manage" but the route handler doesn't call requirePermission("announcement:manage")

```json
{
  "path": "/src/app/api/announcements",
  "declaredPermission": "announcement:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/api-tokens declares "api-token:manage" but the route handler doesn't call requirePermission("api-token:manage")

```json
{
  "path": "/src/app/api/api-tokens",
  "declaredPermission": "api-token:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/app-sources declares "user:manage" but the route handler doesn't call requirePermission("user:manage")

```json
{
  "path": "/src/app/api/app-sources",
  "declaredPermission": "user:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/audit declares "audit:read" but the route handler doesn't call requirePermission("audit:read")

```json
{
  "path": "/src/app/api/audit",
  "declaredPermission": "audit:read"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/backups/[id]/retry declares "backup:create" but the route handler doesn't call requirePermission("backup:create")

```json
{
  "path": "/src/app/api/backups/[id]/retry",
  "declaredPermission": "backup:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/backups/[id]/void declares "backup:create" but the route handler doesn't call requirePermission("backup:create")

```json
{
  "path": "/src/app/api/backups/[id]/void",
  "declaredPermission": "backup:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/backups declares "backup:create" but the route handler doesn't call requirePermission("backup:create")

```json
{
  "path": "/src/app/api/backups",
  "declaredPermission": "backup:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/backups declares "backup:read" but the route handler doesn't call requirePermission("backup:read")

```json
{
  "path": "/src/app/api/backups",
  "declaredPermission": "backup:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/command-templates declares "command:create" but the route handler doesn't call requirePermission("command:create")

```json
{
  "path": "/src/app/api/command-templates",
  "declaredPermission": "command:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/command-templates declares "command:read" but the route handler doesn't call requirePermission("command:read")

```json
{
  "path": "/src/app/api/command-templates",
  "declaredPermission": "command:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/commands declares "command:create" but the route handler doesn't call requirePermission("command:create")

```json
{
  "path": "/src/app/api/commands",
  "declaredPermission": "command:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/commands declares "command:read" but the route handler doesn't call requirePermission("command:read")

```json
{
  "path": "/src/app/api/commands",
  "declaredPermission": "command:read"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/deployments declares "deploy:read" but the route handler doesn't call requirePermission("deploy:read")

```json
{
  "path": "/src/app/api/deployments",
  "declaredPermission": "deploy:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/docker/containers declares "docker:manage" but the route handler doesn't call requirePermission("docker:manage")

```json
{
  "path": "/src/app/api/docker/containers",
  "declaredPermission": "docker:manage"
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
API route /src/app/api/downloads declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/downloads",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/downloads declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/downloads",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/archive-list declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/files/archive-list",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/editable/[id] declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/files/editable/[id]",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/editable/[id] declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/files/editable/[id]",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/extract declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/files/extract",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "share:create" but the route handler doesn't call requirePermission("share:create")

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "share:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "storage:delete" but the route handler doesn't call requirePermission("storage:delete")

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "storage:delete"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/files/list declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/files/list",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/health declares "health:read" but the route handler doesn't call requirePermission("health:read")

```json
{
  "path": "/src/app/api/health",
  "declaredPermission": "health:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id]/file declares "user:read" but the route handler doesn't call requirePermission("user:read")

```json
{
  "path": "/src/app/api/images/[id]/file",
  "declaredPermission": "user:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id] declares "role:manage" but the route handler doesn't call requirePermission("role:manage")

```json
{
  "path": "/src/app/api/images/[id]",
  "declaredPermission": "role:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/[id] declares "storage:delete" but the route handler doesn't call requirePermission("storage:delete")

```json
{
  "path": "/src/app/api/images/[id]",
  "declaredPermission": "storage:delete"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/batch declares "role:manage" but the route handler doesn't call requirePermission("role:manage")

```json
{
  "path": "/src/app/api/images/batch",
  "declaredPermission": "role:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/batch declares "storage:delete" but the route handler doesn't call requirePermission("storage:delete")

```json
{
  "path": "/src/app/api/images/batch",
  "declaredPermission": "storage:delete"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/list declares "image:read" but the route handler doesn't call requirePermission("image:read")

```json
{
  "path": "/src/app/api/images/list",
  "declaredPermission": "image:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/list declares "user:read" but the route handler doesn't call requirePermission("user:read")

```json
{
  "path": "/src/app/api/images/list",
  "declaredPermission": "user:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/publish-from-storage declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/images/publish-from-storage",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/stats declares "user:read" but the route handler doesn't call requirePermission("user:read")

```json
{
  "path": "/src/app/api/images/stats",
  "declaredPermission": "user:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/upload declares "image:write" but the route handler doesn't call requirePermission("image:write")

```json
{
  "path": "/src/app/api/images/upload",
  "declaredPermission": "image:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/images/upload declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/images/upload",
  "declaredPermission": "storage:write"
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
API route /src/app/api/media/[id] declares "media:manage" but the route handler doesn't call requirePermission("media:manage")

```json
{
  "path": "/src/app/api/media/[id]",
  "declaredPermission": "media:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/media/[id]/stream declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/media/[id]/stream",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/media declares "media:manage" but the route handler doesn't call requirePermission("media:manage")

```json
{
  "path": "/src/app/api/media",
  "declaredPermission": "media:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/media declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/media",
  "declaredPermission": "storage:read"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/notifications declares "notification:manage" but the route handler doesn't call requirePermission("notification:manage")

```json
{
  "path": "/src/app/api/notifications",
  "declaredPermission": "notification:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/operation-tasks declares "task:read" but the route handler doesn't call requirePermission("task:read")

```json
{
  "path": "/src/app/api/operation-tasks",
  "declaredPermission": "task:read"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/quick-services/[slug] declares "docker:manage" but the route handler doesn't call requirePermission("docker:manage")

```json
{
  "path": "/src/app/api/quick-services/[slug]",
  "declaredPermission": "docker:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/quick-services/check-port declares "docker:manage" but the route handler doesn't call requirePermission("docker:manage")

```json
{
  "path": "/src/app/api/quick-services/check-port",
  "declaredPermission": "docker:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/quick-services declares "docker:manage" but the route handler doesn't call requirePermission("docker:manage")

```json
{
  "path": "/src/app/api/quick-services",
  "declaredPermission": "docker:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/scheduled-tasks declares "command:create" but the route handler doesn't call requirePermission("command:create")

```json
{
  "path": "/src/app/api/scheduled-tasks",
  "declaredPermission": "command:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/scheduled-tasks declares "command:read" but the route handler doesn't call requirePermission("command:read")

```json
{
  "path": "/src/app/api/scheduled-tasks",
  "declaredPermission": "command:read"
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

### `api-decl-perm-unused` (medium)
API route /src/app/api/servers/monitor declares "server:read" but the route handler doesn't call requirePermission("server:read")

```json
{
  "path": "/src/app/api/servers/monitor",
  "declaredPermission": "server:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/settings declares "user:manage" but the route handler doesn't call requirePermission("user:manage")

```json
{
  "path": "/src/app/api/settings",
  "declaredPermission": "user:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/share-links declares "share:create" but the route handler doesn't call requirePermission("share:create")

```json
{
  "path": "/src/app/api/share-links",
  "declaredPermission": "share:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/share-links declares "share:manage" but the route handler doesn't call requirePermission("share:manage")

```json
{
  "path": "/src/app/api/share-links",
  "declaredPermission": "share:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/share-links declares "share:read" but the route handler doesn't call requirePermission("share:read")

```json
{
  "path": "/src/app/api/share-links",
  "declaredPermission": "share:read"
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
API route /src/app/api/snippets declares "role:manage" but the route handler doesn't call requirePermission("role:manage")

```json
{
  "path": "/src/app/api/snippets",
  "declaredPermission": "role:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/snippets declares "snippet:manage" but the route handler doesn't call requirePermission("snippet:manage")

```json
{
  "path": "/src/app/api/snippets",
  "declaredPermission": "snippet:manage"
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
API route /src/app/api/storage/archive-download declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/archive-download",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/direct-access declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/direct-access",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/local declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/local",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/local declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/storage/local",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/nodes declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/nodes",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-download declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/sftp-download",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:delete" but the route handler doesn't call requirePermission("storage:delete")

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:delete"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-ops declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/storage/sftp-ops",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp-sync declares "storage:write" but the route handler doesn't call requirePermission("storage:write")

```json
{
  "path": "/src/app/api/storage/sftp-sync",
  "declaredPermission": "storage:write"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/storage/sftp declares "storage:read" but the route handler doesn't call requirePermission("storage:read")

```json
{
  "path": "/src/app/api/storage/sftp",
  "declaredPermission": "storage:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/system-health declares "health:read" but the route handler doesn't call requirePermission("health:read")

```json
{
  "path": "/src/app/api/system-health",
  "declaredPermission": "health:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/tickets/[id] declares "ticket:manage" but the route handler doesn't call requirePermission("ticket:manage")

```json
{
  "path": "/src/app/api/tickets/[id]",
  "declaredPermission": "ticket:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/tickets declares "ticket:create" but the route handler doesn't call requirePermission("ticket:create")

```json
{
  "path": "/src/app/api/tickets",
  "declaredPermission": "ticket:create"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/tickets declares "ticket:manage" but the route handler doesn't call requirePermission("ticket:manage")

```json
{
  "path": "/src/app/api/tickets",
  "declaredPermission": "ticket:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/tickets declares "ticket:read" but the route handler doesn't call requirePermission("ticket:read")

```json
{
  "path": "/src/app/api/tickets",
  "declaredPermission": "ticket:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/traffic/summary declares "server:read" but the route handler doesn't call requirePermission("server:read")

```json
{
  "path": "/src/app/api/traffic/summary",
  "declaredPermission": "server:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/users/permissions declares "user:manage" but the route handler doesn't call requirePermission("user:manage")

```json
{
  "path": "/src/app/api/users/permissions",
  "declaredPermission": "user:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/users/permissions declares "user:read" but the route handler doesn't call requirePermission("user:read")

```json
{
  "path": "/src/app/api/users/permissions",
  "declaredPermission": "user:read"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/users declares "user:manage" but the route handler doesn't call requirePermission("user:manage")

```json
{
  "path": "/src/app/api/users",
  "declaredPermission": "user:manage"
}
```

### `api-decl-perm-unused` (medium)
API route /src/app/api/users declares "user:read" but the route handler doesn't call requirePermission("user:read")

```json
{
  "path": "/src/app/api/users",
  "declaredPermission": "user:read"
}
```

