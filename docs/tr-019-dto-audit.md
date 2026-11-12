# TR-019 DTO 边界覆盖审计

Generated: 2026-11-12T00:25:19.608Z

本报告扫描 5 个 TR-019 closure 域的 API route 看其 DTO/schema 边界覆盖率。

**判定规则**: 每个 route file 分三类 — `inline-zod` (声明了 inline `z.object`/`z.enum` 但未 import 共享 boundary) / `boundary-imported` (import 了 `<lib>/dto.ts` 或 `<lib>/schema.ts`) / `no-schema` (没有 zod schema, 不计入分母)。覆盖率 = `boundary-imported / (inline-zod + boundary-imported)`。

## 总体

- 模块审计数: **5**
- API route 总数: **50**
- 仍 inline zod 的 route: **2**
- 已 import boundary 的 route: **30**
- 总体覆盖率: **93.8%**

## 各模块

| 模块 | boundary 文件 | 存在 | route 总数 | inline-zod | 已 import boundary | 无 schema | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `files` | `src/lib/files/dto.ts` | ✅ | 12 | 2 | 6 | 4 | **75.0%** |
| `storage` | `src/lib/storage/schema.ts` | ✅ | 12 | 0 | 8 | 4 | **100.0%** |
| `command` | `src/lib/command/schema.ts` | ✅ | 1 | 0 | 1 | 0 | **100.0%** |
| `ai` | `src/lib/ai/dto.ts` | ✅ | 16 | 0 | 10 | 6 | **100.0%** |
| `backup` | `src/lib/backup/schema.ts` | ✅ | 9 | 0 | 5 | 4 | **100.0%** |

## Inline-zod gap 详情

### files (2 gap routes)

- `src/app/api/files/operations/route.ts` — 1 个 inline zod 站点
  - L248: `bodySchema: z.object({ id: z.string().uuid() }),`
- `src/app/api/files/preferences/route.ts` — 2 个 inline zod 站点
  - L13: `const querySchema = z.object({`
  - L14: `mode: z.enum(["favorites", "recent", "tags", "entry"]).default("favorites"),`

### storage

✅ 无 inline zod gap

### command

✅ 无 inline zod gap

### ai

✅ 无 inline zod gap

### backup

✅ 无 inline zod gap

## Re-run

```bash
npx tsx scripts/tr-019-dto-audit.ts
```
