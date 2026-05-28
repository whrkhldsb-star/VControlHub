# VControlHub 可用性优先升级路线

> **For Hermes:** 后续多轮升级请以本文件为路线图，继续使用系统化调试与小步验证。任何一轮都必须保证 `typecheck`、`lint`、`build` 和部署冒烟测试通过后再上线。

**目标：** 在保留现有功能的前提下，逐轮降低结构混乱、功能半成品和使用体验不一致的问题。

**原则：**
- 可用性优先：每轮都应该让线上更稳定、更好用，而不是只追求“重构漂亮”。
- 小步提交：每轮集中 1-3 个主题，验证后提交推送。
- 路由/API 变薄：API route 只做鉴权、参数解析和响应映射，业务逻辑下沉到 `src/lib/<domain>`。
- UI 一致：页面统一走 `PageShell`、共享错误页、共享操作反馈。

---

## Phase 1：维护性底座与低风险可用性改造（当前轮）

**范围：**
- 抽离文件管理树/路径公共逻辑，避免 `/files` 页面和 `/api/files/list` 行为分叉。
- 统一 33 个路由错误页到共享 `RouteError` 组件，展示错误编号和系统自检入口。
- 保持线上功能和 API 响应兼容。

**验证：**
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `/opt/vcontrolhub` 同步构建与 `deploy/smoke-test.sh`

---

## Phase 2：文件管理体验升级

**问题：**
- `src/app/files/sftp-browser.tsx` 接近千行，目录浏览、同步、编辑、删除、代理状态混杂。
- 文件操作 loading/error/success 反馈不统一。

**任务：**
1. 拆出 `useSftpDirectory`、`useSftpProxy`、`useFileOperation`。
2. 抽 `SftpToolbar`、`SftpEntryList`、`FileOperationDialog`。
3. 统一文件操作错误提示和重复提交防护。
4. 为 `src/lib/files/tree.ts` 增加单元测试，覆盖节点分组、路径规范化、全局搜索。

---

## Phase 3：API guard/error 统一

**问题：**
- 大量 API route 重复 `requireSession`、权限判断、限流和错误返回。
- 前端收到的错误格式不一致，影响可用性。

**任务：**
1. 扩展并推广 `src/lib/http/api-guard.ts`、`src/lib/http/api-error.ts`。
2. 优先改造：`/api/files/*`、`/api/storage/*`、`/api/downloads`。
3. 统一错误 shape：`{ error, code?, details? }`。
4. 确保 401/403/429/500 语义稳定。

---

## Phase 4：页面 UI 一致性和操作反馈

**问题：**
- 页面内重复 Card 样式多，部分页面自定义布局。
- 空状态、错误状态、加载状态不一致。

**任务：**
1. 扩展 `src/components/page-shell.tsx`，补齐 `SectionCard`、`ActionBar`、`InlineStatus`。
2. 优先改造 Dashboard、Files、Servers、Storage、Downloads。
3. 为核心操作增加统一 toast/状态反馈。

---

## Phase 5：重业务路由服务化

**问题：**
- `/api/downloads/route.ts`、`/api/ai/chat/route.ts`、`/api/files/list/route.ts` 等路由仍然承担大量业务流程。

**任务：**
1. Downloads：抽 `src/lib/downloads/commands.ts` 或 `service.ts`，让 route 变薄。
2. AI Chat：抽聊天执行、模型选择、会话持久化流程。
3. Files：进一步把列表响应组装抽到 `src/lib/files/listing.ts`。
4. 增加针对服务层的单元测试。

---

## Phase 6：部署与维护体验

**问题：**
- 源码目录 `/opt/VControlHub` 与运行目录 `/opt/vcontrolhub` 容易混淆。
- 构建流程需要 Next build + runtime bundle。

**任务：**
1. 写清楚发布脚本或 Makefile：`build`、`runtime`、`sync-runtime`、`restart`、`smoke`。
2. `deploy/check.sh` 增加更多不泄密诊断输出。
3. README 补充生产维护命令。

---

## 每轮完成标准

- 类型检查通过。
- lint 通过。
- 生产构建通过。
- 线上 smoke test 通过。
- 改动提交并推送到 GitHub。
- 如发现可复用流程，更新本计划或新增技能。
