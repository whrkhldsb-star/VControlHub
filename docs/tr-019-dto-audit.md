# TR-019 DTO 边界覆盖审计

Generated: 2026-06-16T06:57:34.109Z

本报告扫描 5 个 TR-019 closure 域的 API route 看其 DTO/schema 边界覆盖率。

**判定规则**: 每个 route file 分三类 — `inline-zod` (声明了 inline `z.object`/`z.enum` 但未 import 共享 boundary) / `boundary-imported` (import 了 `<lib>/dto.ts` 或 `<lib>/schema.ts`) / `no-schema` (没有 zod schema, 不计入分母)。覆盖率 = `boundary-imported / (inline-zod + boundary-imported)`。

## 总体

- 模块审计数: **5**
- API route 总数: **28**
- 仍 inline zod 的 route: **20**
- 已 import boundary 的 route: **3**
- 总体覆盖率: **13.0%**

## 各模块

| 模块 | boundary 文件 | 存在 | route 总数 | inline-zod | 已 import boundary | 无 schema | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `files` | `src/lib/files/dto.ts` | ✅ | 4 | 3 | 0 | 1 | **0.0%** |
| `storage` | `src/lib/storage/schema.ts` | ✅ | 9 | 8 | 0 | 1 | **0.0%** |
| `command` | `src/lib/command/schema.ts` | ✅ | 1 | 1 | 0 | 0 | **0.0%** |
| `ai` | `src/lib/ai/dto.ts` | ✅ | 9 | 7 | 0 | 2 | **0.0%** |
| `backup` | `src/lib/backup/schema.ts` | ✅ | 5 | 1 | 3 | 1 | **75.0%** |

## Inline-zod gap 详情

### files (3 gap routes)

- `src/app/api/files/archive-list/route.ts` — 2 个 inline zod 站点
  - L36: `z.object({`
  - L39: `driver: z.enum(["LOCAL", "SFTP"]).default("LOCAL"),`
- `src/app/api/files/editable/[id]/route.ts` — 1 个 inline zod 站点
  - L14: `const saveSchema = z.object({`
- `src/app/api/files/list/route.ts` — 2 个 inline zod 站点
  - L47: `z.object({`
  - L50: `scope: z.enum(["all", "current"]).default("current"),`

### storage (8 gap routes)

- `src/app/api/storage/archive-download/route.ts` — 1 个 inline zod 站点
  - L101: `z.object({`
- `src/app/api/storage/direct-access/route.ts` — 2 个 inline zod 站点
  - L23: `const directAccessSchema = z.object({`
  - L230: `z.object({`
- `src/app/api/storage/local/route.ts` — 1 个 inline zod 站点
  - L93: `z.object({`
- `src/app/api/storage/sftp/route.ts` — 1 个 inline zod 站点
  - L27: `z.object({`
- `src/app/api/storage/sftp-download/route.ts` — 1 个 inline zod 站点
  - L104: `z.object({`
- `src/app/api/storage/sftp-ops/route.ts` — 2 个 inline zod 站点
  - L136: `const postSchema = z.object({`
  - L138: `action: z.enum(["delete", "rename", "read", "write"]),`
- `src/app/api/storage/sftp-stale-inventory/route.ts` — 2 个 inline zod 站点
  - L31: `const staleInventorySchema = z.object({`
  - L51: `z.object({`
- `src/app/api/storage/sftp-sync/route.ts` — 2 个 inline zod 站点
  - L23: `const sftpSyncSchema = z.object({`
  - L90: `z.object({`

### command (1 gap routes)

- `src/app/api/command-templates/route.ts` — 2 个 inline zod 站点
  - L12: `const postSchema = z.object({`
  - L21: `const patchSchema = z.object({`

### ai (7 gap routes)

- `src/app/api/ai/chat/route.ts` — 1 个 inline zod 站点
  - L23: `const chatSchema = z.object({`
- `src/app/api/ai/conversations/[id]/route.ts` — 1 个 inline zod 站点
  - L17: `const updateConversationSchema = z.object({`
- `src/app/api/ai/conversations/route.ts` — 1 个 inline zod 站点
  - L15: `const createConversationSchema = z.object({`
- `src/app/api/ai/models/probe/route.ts` — 1 个 inline zod 站点
  - L11: `const probeModelsSchema = z.object({`
- `src/app/api/ai/models/route.ts` — 1 个 inline zod 站点
  - L25: `z.object({ providerId: z.string().trim().min(1).optional() }),`
- `src/app/api/ai/providers/[id]/route.ts` — 1 个 inline zod 站点
  - L15: `const updateProviderSchema = z.object({`
- `src/app/api/ai/providers/route.ts` — 1 个 inline zod 站点
  - L15: `const createProviderSchema = z.object({`

### backup (1 gap routes)

- `src/app/api/backups/retention/route.ts` — 1 个 inline zod 站点
  - L25: `const retentionInputSchema = z.object({`

## Re-run

```bash
npx tsx scripts/tr-019-dto-audit.ts
```
