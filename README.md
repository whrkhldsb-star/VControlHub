<div align="center">

# 🖥️ VPS 统一管控平台

**一站式 VPS 管理 · SSH 终端 · 分布式云盘 · 应用商店 · 智能运维**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react.dev)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.7-2D3748?logo=prisma.io)](https://www.prisma.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker.com)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-Private-red)]()

</div>

---

## 🌟 项目简介

一个面向个人和小团队的 **VPS 全生命周期管理平台**，将服务器管理、远程终端、文件操作、应用部署、监控告警和 AI 助手整合在统一 Web 界面中。开箱即用，一条命令完成部署。

> 🎯 **核心理念**：把分散的 SSH 客户端、文件管理器、Docker 面板、监控工具 → 统一到一个浏览器标签页

---

## ✨ 功能全景

### 🖧 服务器管理

- **多节点纳管** — 添加/管理多台 VPS，SSH 密钥认证
- **多 Tab SSH 终端** — WebSocket 实时终端，支持多 tab 多会话并行连接，Ctrl/Cmd+Tab 切换，状态指示灯实时反馈
- **SFTP 文件传输** — 终端面板内嵌 SFTP 文件管理器，拖拽上传/下载/删除/重命名/新建文件夹，面包屑导航
- **批量命令** — 服务器多选 + 批量 SSH 命令执行
- **审批流执行** — 敏感操作需管理员审批后才执行，全程审计

### 📁 分布式云盘

- **多节点挂载** — 统一浏览/上传/下载跨服务器文件
- **在线预览** — 图片、视频、音频、文档、压缩包内容一览
- **媒体库** — 聚合图片/视频/音频，支持可视化缩略图/视频首帧/音频封面、标签收藏、类型切换筛选和一键回到源文件/发布外链
- **Aria2 下载** — 内置下载中心，远程任务管理
- **图床外链中心** — 已发布图片外链复制、来源审计、批量管理与兼容直传入口

### 🐳 应用商店 (QuickService)

- **精选商店** — 44+ 本地 Docker 应用模板，一键部署
- **社区推荐** — LinuxServer.io 等第三方源，187+ 应用实时同步
- **应用源管理** — 自定义添加/同步第三方应用目录
- **端口自动分配** — 智能检测可用端口，避免冲突

### 📊 监控与告警

- **系统监控** — CPU / 内存 / 磁盘 / 网络实时图表
- **自定义告警规则** — 灵活配置阈值和触发条件
- **通知中心** — 站内通知 + WebSocket 实时推送

### 🤖 AI 助手

- **多模型支持** — OpenAI / Anthropic / 本地模型自由切换
- **内置工具调用** — 13 项 hosted tools：服务器状态/日志/Docker/服务管理/命令执行/配置修改/Docker 部署/备份列表/Playbook 运行/流量查询/Cron 管理
- **对话历史** — 多轮对话管理 + 上下文保持
- **智能运维** — `/ai-ops` 页面提供 AI 驱动的运维建议与自动诊断

### 🔐 安全与权限

- **RBAC 权限体系** — 用户 / 角色 / 权限三级管理
- **双因子认证 (2FA)** — TOTP 可选启用
- **API Token** — 外部集成 Token 生成与管理
- **操作审计日志** — 全操作留痕，可追溯
- **CSRF 防护** — 全站 CSRF Token + SameSite Cookie
- **API 限流** — 全局 + 端点级 Rate Limiting

### 🛠️ 运维工具

- **定时任务** — Cron 风格调度 + 执行日志
- **命令模板** — 可复用的 SSH 命令模板库
- **Playbook 编排** — 多步骤命令编排，变量替换，条件执行
- **数据备份** — 数据库 / 文件 / 全量三种备份模式，支持定时自动备份（cron 调度 + 保留策略）+ 异地 S3 上传
- **部署管理** — 版本导出、最近部署重发、基于部署快照的真实回滚
- **成本追踪** — 资源成本汇总与趋势分析
- **智能运维** — AI 驱动的运维建议与自动诊断

### 🎨 用户体验

- **深色 / 浅色主题** — 默认暗色 UI，Q-layer 兼容层自动映射旧硬编码到 CSS 变量，支持浅色模式
- **多语言** — 中文 / 英文切换，76 字典文件全覆盖
- **响应式布局** — 适配桌面和平板
- **全局搜索** — 快速跳转任意功能模块

---

## 📸 功能模块一览

| 模块         | 路径               | 说明                                                           |
| ------------ | ------------------ | -------------------------------------------------------------- |
| 仪表盘       | `/`                | 系统概览 + 统计卡片 + 趋势图                                   |
| VPS 管理     | `/servers`         | 节点纳管、SSH 密钥、命令分发                                   |
| SSH 终端     | 多 Tab 终端管理器  | 浏览器内 WebSocket 实时终端，多 tab 并行 + SFTP 文件管理       |
| 文件管理     | `/files`           | 多节点文件浏览/上传/下载/解压，支持可搜索节点下拉切换          |
| 云盘存储     | `/storage`         | 本地/SFTP 存储节点管理与同步                                   |
| 应用商店     | `/quick-services`  | 精选商店 / 社区推荐 / 已安装 / 应用源                          |
| Docker       | `/docker`          | 容器管理（通过应用商店安装）                                   |
| 监控         | `/monitoring`      | 系统资源实时图表                                               |
| 告警规则     | `/alert-rules`     | 自定义监控告警                                                 |
| 通知         | `/notifications`   | 站内消息中心                                                   |
| AI 助手      | `/ai`              | 多模型 AI 对话 + 工具调用，高风险操作需确认                    |
| 智能运维     | `/ai-ops`          | AI 驱动的运维建议与诊断                                        |
| 命令模板     | `/templates`       | 可复用 SSH/部署模板，提交后进入部署/审批记录                   |
| Playbook     | `/playbooks`       | 多步骤命令编排，变量替换                                       |
| 定时任务     | `/scheduled-tasks` | Cron 调度 + 执行日志                                           |
| 备份         | `/backups`         | 数据库/文件/全量备份 + 恢复 + 定时备份调度                     |
| 部署         | `/deployments`     | 应用部署运行记录、版本导出、最近部署重发与快照级真实回滚       |
| 下载中心     | `/downloads`       | Aria2 任务管理                                                 |
| 图床外链中心 | `/image-bed`       | 已发布图片外链复制、来源审计与兼容发布                         |
| 媒体         | `/media`           | 在线媒体浏览                                                   |
| 成本追踪     | `/cost-summary`    | 资源成本汇总与趋势分析                                         |
| 公开状态页   | `/status`          | 公开服务健康状态                                               |
| 工单         | `/tickets`         | 内部工单系统                                                   |
| 公告         | `/announcements`   | 站内公告管理                                                   |
| 分享         | `/shares`          | 文件分享链接                                                   |
| 代码片段     | `/snippets`        | 代码片段收藏                                                   |
| 用户管理     | `/users`           | 用户 / 角色 / 权限管理                                         |
| 审计日志     | `/audit`           | 操作审计追溯                                                   |
| API 文档     | `/api-docs`        | API 端点参考                                                   |
| API Token    | `/api-tokens`      | 集成用 Token 管理                                              |
| 系统设置     | `/settings`        | 全局配置                                                       |
| 个人偏好     | `/preferences`     | 用户偏好设置                                                   |
| 健康检查     | `/health`          | 服务健康状态                                                   |

---

## 🚀 快速部署

### 前置条件

- **OS** — Debian / Ubuntu 22.04+（root 权限）
- **域名** — 可选（无域名时自动配置 Apache/IP 直连模式）
- **端口** — 80/443（Web）+ 3001（SSH-WS）

### 真正一行 fresh server 安装（推荐）

在干净 Debian/Ubuntu systemd 服务器上，直接执行一行命令即可拉取仓库、安装依赖、生成生产环境变量、初始化 PostgreSQL、构建产物、写入 systemd/反向代理并启动服务：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo DOMAIN=your.example.com bash
```

无域名时也可以省略 `DOMAIN`，脚本会走 IP 直连/本地代理模式：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo bash
```

可选自定义安装目录/品牌：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo APP_NAME="VControlHub" APP_SLUG=vcontrolhub APP_DIR=/opt/vcontrolhub DOMAIN=your.example.com bash
```

安装完成后如需查看自动生成的首次登录密码：

```bash
sudo /opt/vcontrolhub/deploy/install.sh --show-credentials
```

### 传统手动安装（保留）

```bash
# 1. 克隆代码
git clone https://github.com/whrkhldsb-star/VControlHub.git /opt/vcontrolhub

# 2. 首次运行（自动安装 Node.js 22、PostgreSQL 15、Caddy 等依赖）
sudo APP_DIR=/opt/vcontrolhub /opt/vcontrolhub/deploy/install.sh

# 3. 编辑环境变量后再次运行
sudoedit /opt/vcontrolhub/.env.local
sudo APP_DIR=/opt/vcontrolhub /opt/vcontrolhub/deploy/install.sh
```

> 首次运行会自动生成 `.env.local` 模板并暂停，填写数据库密码、密钥后重新运行即可。

### 自定义品牌部署

```bash
sudo APP_NAME="MyCloud" APP_SLUG=mycloud SITE_NAME="My Cloud Platform" \
  DOMAIN=cloud.example.com APP_DIR=/opt/mycloud \
  /opt/mycloud/deploy/install.sh
```

### 更多部署方式

| 方式             | 适用场景              | 说明                                        |
| ---------------- | --------------------- | ------------------------------------------- |
| Git 仓库拉取     | 有 GitHub/GitLab 仓库 | `install.sh` 直接从仓库部署                 |
| 压缩包离线       | 无公网/内网交付       | `package.sh` 打包 → 传到新机 → `install.sh` |
| rsync 同步       | 不入公网仓库          | 从旧服务器 rsync 源码 → `install.sh`        |
| Caddy 自动 HTTPS | 有域名                | 默认启用；无域名自动切换 Apache             |

详见 [deploy/README.md](deploy/README.md)

---

## ⚙️ 技术栈

| 层级     | 技术                                        | 版本     |
| -------- | ------------------------------------------- | -------- |
| 框架     | Next.js (App Router)                        | 16.2.6   |
| UI       | React + Tailwind CSS                        | 19 / 4   |
| 数据库   | PostgreSQL + Prisma                         | 15 / 7.7 |
| 认证     | 自定义 Session + bcryptjs                   | —        |
| SSH      | ssh2 + WebSocket                            | 1.17     |
| 下载     | Aria2 JSON-RPC                              | —        |
| 反向代理 | Caddy (自动HTTPS) / Apache                  | —        |
| 进程管理 | systemd                                     | —        |
| 容器     | Docker (应用商店)                           | —        |
| 代码量   | **~163,800 行** TypeScript/TSX（`src` 扫描） | —        |

---

## 📁 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router (46 页面 + 122 API)
│   │   ├── api/                # API Routes (RESTful)
│   │   ├── servers/            # VPS 管理
│   │   ├── files/              # 文件管理
│   │   ├── quick-services/     # 应用商店
│   │   ├── monitoring/         # 监控面板
│   │   ├── ai/                 # AI 助手
│   │   └── ...                 # 其他功能模块
│   ├── components/             # 共享 UI 组件 (29 个)
│   └── lib/                    # 业务逻辑 + 工具库
│       ├── auth/               # 认证 & 权限（自定义 Session + bcryptjs + RBAC）
│       ├── ssh/                # SSH 客户端 + SFTP 服务
│       ├── quick-service/      # 应用商店引擎
│       ├── ai/                 # AI 服务 + 工具
│       ├── backup/             # 备份 job worker + 调度
│       ├── i18n/               # 国际化（76 字典文件）
│       ├── storage/            # 分布式存储
│       └── ...                 # 其他模块
├── deploy/                     # 部署脚本 & 配置模板
│   ├── bootstrap.sh            # fresh server 一行安装入口
│   ├── install.sh              # 一键安装/升级核心脚本
│   ├── upgrade.sh              # 升级（含备份+自检）
│   ├── setup.sh                # 环境初始化（Node.js/PG/Caddy）
│   ├── package.sh              # 打发布压缩包
│   ├── check.sh                # 部署健康检查
│   ├── preflight.sh            # 部署前校验
│   ├── verify-assets.sh        # 部署模板/资产校验（无需 live install）
│   ├── fakeroot-install-check.sh  # 安装回归测试（不修改宿主）
│   ├── backup.sh               # 备份包装脚本（database/files/full）
│   ├── smoke-test.sh           # 冒烟测试
│   ├── systemd/                # systemd 服务模板
│   ├── Caddyfile.example       # Caddy 配置示例
│   ├── apache-next-proxy.example.conf  # Apache 配置示例
│   └── env.production.example  # 环境变量模板
├── prisma/                     # 数据库 Schema (55 模型) + 迁移
├── scripts/                    # 运维脚本
└── public/                     # 静态资源
```

---

## 🔧 开发与维护

```bash
# 安装依赖
npm ci

# 开发模式 (http://localhost:3000)
npm run dev

# 类型检查 / 代码检查 / 测试
npm run typecheck
npm run lint
npm test

# 生产构建：Next.js + systemd 运行所需 runtime bundle
npm run build
npm run build:runtime

# 一次性完整质量门禁
npm run verify
```

生产服务器上推荐使用仓库自带 Makefile，避免忘记 runtime bundle 或 smoke：

```bash
# 查看可用入口
make help

# 构建、重启、检查、冒烟
make verify
sudo make restart
make deploy-check
make smoke DOMAIN=whrkhldsb.qzz.io SERVICE_PREFIX=vcontrolhub

# 查看服务状态和日志
make status SERVICE_PREFIX=vcontrolhub
make logs SERVICE_PREFIX=vcontrolhub
```

常用脚本用途：

| 文件                   | 用途                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/bootstrap.sh`  | fresh server 一行安装入口，负责拉取仓库并调用安装脚本                                                                                            |
| `deploy/install.sh`    | 一键安装/重装/升级核心脚本，生成环境变量、构建、写 systemd 和反代                                                                                |
| `deploy/setup.sh`      | 环境初始化（Node.js/PostgreSQL/Caddy 安装）                                                                                                       |
| `deploy/upgrade.sh`    | 升级入口，默认升级前备份并在完成后自检                                                                                                           |
| `deploy/check.sh`      | 不泄密的部署健康检查，可选 `RUN_NPM_CHECKS=1` 执行完整 npm 门禁                                                                                  |
| `deploy/smoke-test.sh` | 线上冒烟测试，覆盖 systemd、端口、Caddy、登录页、静态资源和 SSH-WS                                                                               |
| `deploy/verify-assets.sh` | 验证部署模板/资产完整性，无需 live install                                                                                                    |
| `deploy/fakeroot-install-check.sh` | 安装流程回归测试，不修改宿主服务                                                                                                         |
| `deploy/package.sh`    | 生成不含运行数据/密钥的发布压缩包                                                                                                                |
| `deploy.sh`            | 修源 owner → 清 `.next` → 以 `vcontrolhub` 用户 build → chown `.next` → 重启服务 → smoke-test 一条龙（避免 root 跑 build 导致 service 启动失败） |

---

## 🔒 安全设计

- ✅ 生产环境自动拒绝 demo/seed 环境变量
- ✅ `.env.local` 不入库，安装脚本校验占位值
- ✅ SSH 使用密钥认证，私钥 AES-256 加密存储
- ✅ Session 密钥 ≥ 32 字符
- ✅ 全站 CSRF Token + SameSite Cookie
- ✅ API 全局限流 + 端点级限流
- ✅ RBAC 权限体系，最小权限原则
- ✅ 双因子认证 (TOTP) 可选
- ✅ 完整操作审计日志
- ✅ systemd 安全加固（NoNewPrivileges / ProtectSystem / MemoryMax）

---

## 📊 项目规模

| 指标            | 数量                                             |
| --------------- | ------------------------------------------------ |
| 功能页面        | 46                                               |
| API 路由文件     | 138                                              |
| 数据模型        | 55                                               |
| UI 组件         | 29                                               |
| 代码行数        | ~163,800（src 扫描）                             |
| 测试            | 380 文件                                         |
| Docker 应用模板 | 44 (本地) + 社区源实时同步                       |
| i18n            | 210 useI18n() 调用点，73 字典文件                 |

---

## 🔬 全量代码审查（2026-07-05）

> 本节只记录本轮复审确认仍未解决、可执行的真实问题。已完成项与误报不再保留。

**审查范围**：前端交互/可访问性、API/权限/安全、Prisma/数据访问、部署与架构治理。
**本轮基线**：`git status` 干净；`vcontrolhub-next` 运行于 `/opt/VControlHub`；上一轮 `typecheck/test/lint/i18n:key-check/build` 已通过。
**快速扫描结果**：生产非测试非字典 TS/TSX >500 行为 0；`src/app` + `src/components` 生产非测试 TS/TSX 硬编码中文为 0。

### 🔴 P1 — 优先修复

| # | 问题 | 证据 | 建议修复 / 验证 |
| --- | --- | --- | --- |
| 1 | **Bearer 头在 proxy 层仅凭格式跳过 session 预检与 CSRF**：任意 `Authorization: Bearer ***` 都会让 proxy 放行到 route，并跳过状态修改 API 的 CSRF 检查；但统一 `withApiRoute()` / `requireApiPermission()` 并不验证 Bearer token。 | `src/proxy.ts`：`hasBearerToken` 只判断 `startsWith("bearer ")`，line ~166 跳过无 session 401，line ~193-197 跳过 CSRF；`src/lib/http/api-guard.ts` 与 `require-api-permission.ts` 仍只走 cookie session；`bearer-token.ts` 的 `verifyBearerToken()` 未接入统一 guard。 | proxy 不应把 Bearer 格式等同认证。仅明确支持 API token 的 endpoint 才可绕过 cookie/CSRF；或把 Bearer 验证下沉到 `withApiRoute({ bearerScope })`，无效 token fail closed。验证：新增 proxy/API guard 测试，`Bearer invalid` 对普通 POST 仍需 CSRF 或返回 401。 |
| 2 | **媒体流与缩略图 API 未走统一 API guard / rate limit**：`/api/media/[id]/stream` 与 `/api/media/[id]/thumbnail` 使用页面型 `requireSession("/media")`，不是 JSON API auth 语义，也缺少统一限流。 | `src/app/api/media/[id]/stream/route.ts`、`thumbnail/route.ts`：直接 `requireSession` + `sessionHasPermission`，未用 `withApiRoute()` / `GENERAL_READ_LIMIT`。 | 迁移到 `withApiRoute(request, { permission: "storage:read", rateLimit: GENERAL_READ_LIMIT })`；保留 Range/stream、缩略图缓存、SFTP circuit breaker、`assertStorageAccess`。验证：`npm test -- --run src/app/api/media`，未登录 curl 应返回 JSON 401/403 而非页面 redirect。 |
| 3 | **真实部署回滚缺服务端幂等/并发保护**：快速重复 POST 可创建多个 rollback run / command request；客户端 `pending` 只能挡单 tab。 | `src/app/api/deployments/[id]/rollback/route.ts` 调 `createDeploymentRollbackRun()`；`src/lib/deployment/service.ts` 先 `deploymentRollbackRun.create()` 再 `createCommandRequest()`，创建前未检查同一 `sourceRunId` 是否已有 `PENDING/RUNNING/APPROVED` rollback。 | 在 service 层用 transaction/锁语义检查同一 source run 的进行中 rollback；第二次返回已有任务或 409。route 映射 `CONFLICT`。验证：`npm test -- --run src/app/api/deployments src/lib/deployment`，并加连续双 POST 回归测试。 |
| 4 | **Dashboard analytics 只校验登录，未校验分域权限**：任何已登录用户可读服务器指标、下载趋势、审计活动和图床趋势。 | `src/app/api/dashboard/analytics/route.ts` 只 `getApiSession()`；无 `sessionHasPermission()` / `requireApiPermission()` / `withApiRoute()`；返回 `metricSnapshot`、`downloadTask`、`auditLog`、`imageUpload` 聚合。 | 迁移统一 guard；按 `type` 做分域权限过滤（如 server/download/audit/image 权限）或引入 dashboard read 权限。验证：`npm test -- --run src/app/api/dashboard`，覆盖低权限用户不可读 audit/server 全局趋势。 |

### 🟡 P2 — 中优先级

| # | 问题 | 证据 | 建议修复 / 验证 |
| --- | --- | --- | --- |
| 5 | **备份“标记作废”破坏性操作缺少二次确认**。 | `src/app/backups/void-backup-record-button.tsx`：`onClick={handleVoid}` 后直接 `POST /api/backups/${backupId}/void`；同目录 restore 需要输入 `RESTORE`，删除计划有确认对话框。 | 改成 `alertdialog` 或输入 `VOID`/备份 ID 的确认模式；更新 `void-backup-record-button.test.tsx`。验证：`npm test -- --run src/app/backups`。 |
| 6 | **AI provider / hosted-actions 读接口权限偏宽**：写操作有 `ai:manage`，读操作仅 `requireAuth`，可能让普通登录用户读 provider 元数据、masked key、baseUrl、待审批操作元数据。 | `src/app/api/ai/providers/route.ts`、`providers/[id]/route.ts` GET 使用 `requireAuth: true`；PATCH/DELETE 才 `permission: "ai:manage"`。`src/app/api/ai/hosted-actions/route.ts` GET 仅 requireAuth。 | 为 provider GET 使用 `ai:manage` 或新增 `ai:read`；hosted-actions GET 使用 `ai:chat` / `ai:action:read` / requester-or-approver 过滤。验证：`npm test -- --run src/app/api/ai`。 |
| 7 | **SSH 连接缺 host key / known_hosts 校验**，管理面 SSH/SFTP 无法确认目标主机身份。 | `src/lib/ssh/client.ts` 构造 `ConnectConfig` 仅 host/port/username/privateKey/password/timeout，未设置 `hostVerifier` / `hostHash`；调用覆盖 media stream/thumbnail、share token、AI hosted service 等。 | 为 server/storage node 存储 SSH host key fingerprint；首次连接 TOFU 审批，后续 `hostVerifier` 校验，变更需人工确认与审计。验证：`rg "hostVerifier|hostHash|known_hosts|client\.connect" src` + SSH client tests。 |
| 8 | **公开分享下载接口无速率限制，密码型分享可被在线爆破/枚举**。 | `src/proxy.ts` 将 `/api/share/` 设为 public；`src/app/api/share/[token]/route.ts` 注释“share token 本身是凭据”，接收 `password` query，未见 rate limit。 | 对 IP + token 加限流；密码失败计数/递增延迟；密码改 POST body 避免日志/Referer 泄露。验证：`npm test -- --run src/app/api/share`。 |
| 9 | **私有图片文件读取权限语义偏粗，且未统一限流**：public 图片匿名读取合理，但 private 图片用 `user:read` 作为全局读权限不够贴合图床/存储边界。 | `src/app/api/images/[id]/file/route.ts`：private 图片允许 owner 或 `sessionHasPermission(session, "user:read")`；未用统一 API guard/rate limit。 | 引入/复用 `image:read` 或 `storage:read` + owner 检查；public path 加读取限流，private path 走 JSON auth。验证：`npm test -- --run src/app/api/images`。 |
| 10 | **Markdown 预览链接拼接边界仍偏脆弱**：自制 Markdown renderer 在 `dangerouslySetInnerHTML` 路径中拼 `<a href="${url.trim()}">${text}</a>`，只拦 `javascript/data/vbscript`，未对 href/text 在拼接点做显式二次 escape / scheme allowlist。 | `src/app/files/preview/markdown-preview-client.tsx` `inlineFormat()`；最终进入 `dangerouslySetInnerHTML`。虽然动态 sanitizer 会再处理，但 renderer 自身边界不够清晰。 | 在 link callback 内对 href/text 显式 escape；限制 `http: / https: / mailto: / 相对路径`；增加 attribute injection 与恶意链接文本测试。验证：`npm test -- --run src/app/files`。 |
| 11 | **文件预览页对 query `href` 缺少前端允许前缀约束**：`href` 直接来自 `searchParams`，传给 image/iframe/fetch preview client。 | `src/app/files/preview/page.tsx`：`const href = params?.href ?? ""`，随后作为 `img src`、`iframe src`、`MarkdownPreviewClient href`、`TextPreviewClient href`。 | 只允许同源相对路径和明确 API 前缀（如 `/api/files/`、`/api/storage/`、`/api/media/`）；非法 URL 显示本地错误且不发 fetch。验证：访问 `/files/preview?type=text&href=https://example.com` 应显示错误。 |
| 12 | **生产组件仍存在超长单行 JSX，行数达标但维护性差**。 | 最大行长扫描命中：`server-card-actions.tsx` line 8 ~15147、`media/page.tsx` line 15 ~13660、`docker-resources-panel.tsx` line 8 ~9654、`server-create-form.tsx` line 10 ~8264、`media-item-card.tsx` line 15 ~7998、`ssh-key-create-form.tsx` line 1 ~6108 等。 | 格式化为多行 JSX，必要时继续按组件/helper 拆分；新增最大行长扫描（生产 TS/TSX >1000 chars fail）。验证：`npm run typecheck` + 相关页面测试 + max-line scan。 |
| 13 | **字典文件继续膨胀，i18n 域边界过大**。 | `src/lib/i18n/dictionaries/servers.ts` 641 行；`settings-page.ts` 626 行。`servers.ts` 混合 servers page、server card actions、Direct Gateway、VPS backup、monitor、SSH key、batch panel。 | 按子域拆分字典并在聚合器保持同一 key space。验证：`npm run i18n:key-check` + 字典行数扫描。 |
| 14 | **系统导入预览/执行对导入 payload 做单次大 `IN (...)` 查询，缺少分批上限**。 | `src/lib/system/import-preview-tables.ts` 多处 `ids = records.map(...)` 后 `findMany({ where: { id: { in: ids }}})`；`import-executors-config.ts` 等同类 key/id 查询。不是全表扫描，但大导入包会产生超大 IN。 | 增加 `chunkedFindExistingIds(..., chunkSize=500/1000)` helper，preview/executor 共用；对 2000+ records 加测试。验证：`npm test -- --run src/lib/system`。 |
| 15 | **Dashboard 聚合查询缺匹配索引，且在 Node 层拉 5k/10k 行聚合**。 | `dashboard/analytics/route.ts` 按 `createdAt >= ... orderBy createdAt` 查 `MetricSnapshot`、`DownloadTask`、`ImageUpload`；schema 主要是 `[serverId, createdAt]`、`[status, createdAt]`、`[userId/isPublic, createdAt]`，缺全局 `createdAt` 索引。 | 为实际全局时间查询补 `@@index([createdAt])`；后续把小时/日聚合下推 SQL。验证：Prisma migrate/db push + `npm test -- --run src/app/api/dashboard`。 |
| 16 | **系统 health 页面只检查 `DATABASE_URL` 字符串，不做真实 DB probe**。 | `src/lib/system-health/service.ts` line ~121-128：仅判断 `config.db.url !== "REPLACE_WITH_DATABASE_URL"`，未执行 `SELECT 1` / `$connect`。 | 增加短超时 `prisma.$queryRaw\`SELECT 1\``，区分 env 缺失、连接失败、查询超时。验证：`npm test -- --run src/app/api/system-health src/lib/system-health`。 |
| 17 | **`deploy/check.sh RUN_NPM_CHECKS=1` 会构建 Next，但不会重新生成 runtime bundle**。 | `deploy/check.sh` line ~117-125 执行 `prisma:generate/typecheck/lint/test/build`，缺 `npm run build:runtime`；systemd 实际运行 `dist/server.js`。 | 在 npm checks 末尾追加 `npm run build:runtime`，与 `deploy/install.sh` / 当前部署流程一致。验证：`RUN_NPM_CHECKS=1 deploy/check.sh` 后检查 `dist/server.js` mtime。 |
| 18 | **README 项目规模数字仍需自动生成/校验**。 | 本轮已把静态值更新为当前扫描：pages=46、api route files=138、test files=380、dictionary files=73、`useI18n(`=210；但仍是手写。 | 新增 `scripts/readme-metrics.ts` / `npm run docs:check` 自动生成或校验项目规模区块；README 标注生成来源。验证：`npm run docs:check`。 |

### 🟢 P3 — 低优先级 / 治理增强

| # | 问题 | 证据 | 建议修复 / 验证 |
| --- | --- | --- | --- |
| 19 | **API guard 例外/Barrel 路由缺少机器可读声明，审计工具仍需人工分辨例外与真问题**。 | 粗扫不含 `withApiRoute` 会命中 login、2FA verify、share token、openapi、downloads barrel、media stream/thumbnail；其中部分是合理例外/委托 guard，media 是迁移候选。 | 约定 `export const guardMode = "public" | "login" | "delegated" | "manual" | "withApiRoute"`，让 route catalog/verify 脚本识别。验证：新增 route-catalog check。 |
| 20 | **媒体卡片资源链接语义不清，存在 `href="#"` fallback**。 | `src/app/media/media-item-card.tsx` `MediaCover` 返回 `<a href={sourceHref ?? fileHref ?? "#"}>`；资源打开可用 `<a>`，但 `#` fallback 会产生不可达/跳顶行为。 | 区分页面导航与资源打开；无有效 href 时渲染 disabled button/静态卡片。验证：`npm test -- --run src/app/media`。 |
| 21 | **缺少生产实例 drift-check 入口**。 | README 有 `deploy/check.sh`、`deploy/smoke-test.sh`、`deploy.sh`，但没有专门检查 systemd `WorkingDirectory/ExecStart`、git HEAD、`dist/server.js`、`.next/BUILD_ID` 与当前 checkout 是否一致的目标；历史上踩过 `/opt/VControlHub` vs `/opt/vcontrolhub` 漂移。 | 新增 `deploy/drift-check.sh` 或 `make drift-check`，输出 systemd 工作目录、ExecStart、git HEAD、构建产物时间、local `/login` smoke。验证：`make drift-check`。 |
| 22 | **E2E 截图产物被跟踪且测试会覆盖仓库根目录 PNG**。 | `git ls-files` 包含 `login-dark.png`、`login-light.png`；`e2e/screenshot.spec.ts` 输出同名根目录文件。 | 输出到 `.hermes/qa-runs/` / `test-results/` 等忽略目录；若保留基线图，放 fixtures 且测试不覆盖。验证：`git status` 跑 e2e screenshot 后不出现 PNG diff。 |
| 23 | **Next 图片优化允许任意 HTTPS 远程域名**。 | `next.config.ts` `images.remotePatterns = [{ protocol: "https", hostname: "**" }]`。 | 限制到可信图床/CDN/对象存储域名；用户外链预览使用普通 `<img>` 或 `unoptimized`。验证：`npm run typecheck` + image 相关页面 smoke。 |

---

## 📄 许可
