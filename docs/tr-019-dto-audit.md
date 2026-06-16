# TR-019 DTO 边界覆盖审计

Generated: 2026-06-16T09:10:54.042Z

本报告扫描 5 个 TR-019 closure 域的 API route 看其 DTO/schema 边界覆盖率。

**判定规则**: 每个 route file 分三类 — `inline-zod` (声明了 inline `z.object`/`z.enum` 但未 import 共享 boundary) / `boundary-imported` (import 了 `<lib>/dto.ts` 或 `<lib>/schema.ts`) / `no-schema` (没有 zod schema, 不计入分母)。覆盖率 = `boundary-imported / (inline-zod + boundary-imported)`。

## 总体

- 模块审计数: **5**
- API route 总数: **28**
- 仍 inline zod 的 route: **2**
- 已 import boundary 的 route: **22**
- 总体覆盖率: **91.7%**

## 各模块

| 模块 | boundary 文件 | 存在 | route 总数 | inline-zod | 已 import boundary | 无 schema | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `files` | `src/lib/files/dto.ts` | ✅ | 4 | 0 | 3 | 1 | **100.0%** |
| `storage` | `src/lib/storage/schema.ts` | ✅ | 9 | 0 | 8 | 1 | **100.0%** |
| `command` | `src/lib/command/schema.ts` | ✅ | 1 | 1 | 0 | 0 | **0.0%** |
| `ai` | `src/lib/ai/dto.ts` | ✅ | 9 | 0 | 8 | 1 | **100.0%** |
| `backup` | `src/lib/backup/schema.ts` | ✅ | 5 | 1 | 3 | 1 | **75.0%** |

## Inline-zod gap 详情

### files

✅ 无 inline zod gap

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
