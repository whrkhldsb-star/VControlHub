# TR-019 DTO 边界覆盖审计

Generated: 2026-06-16T08:35:39.002Z

本报告扫描 5 个 TR-019 closure 域的 API route 看其 DTO/schema 边界覆盖率。

**判定规则**: 每个 route file 分三类 — `inline-zod` (声明了 inline `z.object`/`z.enum` 但未 import 共享 boundary) / `boundary-imported` (import 了 `<lib>/dto.ts` 或 `<lib>/schema.ts`) / `no-schema` (没有 zod schema, 不计入分母)。覆盖率 = `boundary-imported / (inline-zod + boundary-imported)`。

## 总体

- 模块审计数: **5**
- API route 总数: **28**
- 仍 inline zod 的 route: **5**
- 已 import boundary 的 route: **19**
- 总体覆盖率: **79.2%**

## 各模块

| 模块 | boundary 文件 | 存在 | route 总数 | inline-zod | 已 import boundary | 无 schema | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `files` | `src/lib/files/dto.ts` | ✅ | 4 | 3 | 0 | 1 | **0.0%** |
| `storage` | `src/lib/storage/schema.ts` | ✅ | 9 | 0 | 8 | 1 | **100.0%** |
| `command` | `src/lib/command/schema.ts` | ✅ | 1 | 1 | 0 | 0 | **0.0%** |
| `ai` | `src/lib/ai/dto.ts` | ✅ | 9 | 0 | 8 | 1 | **100.0%** |
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

### storage

✅ 无 inline zod gap

### command (1 gap routes)

- `src/app/api/command-templates/route.ts` — 2 个 inline zod 站点
  - L12: `const postSchema = z.object({`
  - L21: `const patchSchema = z.object({`

### ai

✅ 无 inline zod gap

### backup (1 gap routes)

- `src/app/api/backups/retention/route.ts` — 1 个 inline zod 站点
  - L25: `const retentionInputSchema = z.object({`

## Re-run

```bash
npx tsx scripts/tr-019-dto-audit.ts
```
