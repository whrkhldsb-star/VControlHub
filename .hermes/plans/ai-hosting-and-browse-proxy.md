# AI 服务器托管 + 审批联动 & 浏览流量节点切换 实现计划

## 功能一：AI 服务器托管 + 审批联动

### 核心概念
- AI 对话中可触发"工具调用"（Function Calling），执行 VPS 管理操作
- 危险操作（重启、删除、修改配置等）自动生成审批请求，需用户批准后执行
- 安全操作（查看状态、读取日志等）可直接执行

### 数据模型变更
1. **AiMessage** 增加 `toolCalls` 字段（JSON，存储 function call）
2. **新增 AiHostedAction 模型** — AI 托管操作记录
   - id, conversationId, messageId, serverId, actionType, params(JSON), 
   - status: PENDING_APPROVAL / APPROVED / REJECTED / EXECUTING / COMPLETED / FAILED
   - requesterId(AI→system), approverId, result(JSON), createdAt, executedAt
3. **复用 CommandRequest/CommandApproval** — AI 触发的命令请求也走审批流

### API 变更
1. `/api/ai/chat/route.ts` — 增加 tools 定义（function calling）
   - `get_server_status` — 安全，直接执行
   - `read_server_logs` — 安全，直接执行  
   - `execute_command` — 危险，需审批
   - `restart_service` — 危险，需审批
   - `modify_config` — 危险，需审批
   - `deploy_docker` — 危险，需审批
2. `/api/ai/hosted-actions` — CRUD 托管操作
3. `/api/ai/hosted-actions/[id]/approve` — 审批接口

### 前端变更
1. `ai-client.tsx` — 增加"托管模式"开关、工具调用结果展示、审批按钮
2. 新增 `ai-hosted-action-panel.tsx` — 托管操作列表+审批面板
3. 复用现有 `requests` 页面 — AI 发起的审批请求也显示在这里

---

## 功能二：在线浏览流量节点切换

### 核心概念
- 在线文件浏览时，可选择流量经过的节点：
  - **管理服务器模式**：文件内容经管理服务器中转（默认，现有行为）
  - **目标服务器直连模式**：浏览器直接从目标服务器获取文件内容
- 直连模式需要目标服务器有可公开访问的文件代理端点

### 实现方式
1. **管理服务器模式（默认）** — 现有行为，通过 `/api/storage/` 代理
2. **目标服务器直连模式**：
   - 在目标服务器上临时启动一个一次性文件服务（通过 SSH 执行 python -m http.server）
   - 或者在目标服务器上部署一个轻量 Agent（Node 脚本/Python 脚本）
   - 返回直连 URL 给浏览器
3. **节点切换 UI** — 在文件浏览页面添加节点选择器

### 数据模型变更
1. **Server** 增加 `publicUrl` 字段 — 目标服务器的公网访问地址
2. **Server** 增加 `fileProxyPort` 字段 — 文件代理端口
3. **新增 ServerAgent 模型** — 服务器 Agent 状态
   - serverId, agentType, status, lastHeartbeat, config(JSON)

### API 变更
1. `/api/storage/direct-access` — 增强为支持直连模式
2. `/api/servers/[id]/file-proxy` — 启动/停止目标服务器上的文件代理
3. `/api/servers/[id]/agent` — Agent 状态管理

### 前端变更
1. `files-browser-spa.tsx` — 增加节点切换按钮
2. 文件预览组件 — 根据节点选择使用不同 URL
3. `sftp-browser.tsx` — 同上

---

## 实施顺序
1. Prisma schema 变更 + db push
2. AI Function Calling 后端（tools 定义 + 处理逻辑）
3. AI 托管审批流程
4. AI 前端托管 UI
5. 浏览节点切换后端
6. 浏览节点切换前端
7. 构建测试 + 部署
