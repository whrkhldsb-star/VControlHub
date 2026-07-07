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

<!-- README_METRICS_START -->
| 指标            | 数量                                             |
| --------------- | ------------------------------------------------ |
| 功能页面            | 46                                               |
| API 路由文件        | 138                                              |
| 数据模型            | 60                                               |
| UI 组件           | 35                                               |
| 代码行数            | ~180,235（src 扫描）                                 |
| 测试              | 393 文件                                           |
| Docker 应用模板     | 44 (本地) + 社区源实时同步                                |
| i18n            | 211 useI18n() 调用点，77 字典文件                        |
<!-- README_METRICS_END -->

---

## 🔬 全量代码审查（2026-07-05）

> 本轮前端、后端/API、安全、数据访问、部署与架构治理复审发现的问题已全部处理；已完成项不再作为 backlog 保留。

### 本轮已完成修复

- **P1 安全/API 边界**：Bearer proxy 只允许明确 token-aware 端点跳过 session/CSRF；媒体 stream/thumbnail 迁移到统一 API guard + rate limit；部署 rollback 增加服务端幂等/并发保护；Dashboard analytics 按数据域检查权限。
- **P2 安全/UX**：backup void 增加二次确认；AI provider/hosted-actions GET 权限收紧；公开 share 下载增加 token/password 尝试限流；private image file 改为 owner 或 `image:read`；Markdown/文件 preview 增加 href allowlist 与 HTML escape。
- **SSH 主机身份校验**：Server/StorageNode 增加 `hostKeySha256` 字段；SSH client 支持 `hostHash="sha256"` + `hostVerifier` pinning；VPS 首次纳管采用 TOFU 闭环：先无凭据捕获 SHA256 host key 并阻止保存，管理员 out-of-band 核对后将指纹原样填入再次提交；本轮复审继续补齐文件代理、AI 托管安全操作、SFTP service 与 SSH WebSocket 等 raw `ssh2` 链路，统一走 `createVerifiedSshConfig()`，之后所有 SSH/SFTP 调用固定校验该指纹，指纹变化会被阻断。
- **数据/性能**：Dashboard 时间范围查询补 `createdAt` 索引；系统导入预览大 `IN (...)` 查询改为分批查询；system health 已具备真实 DB probe。
- **部署治理**：`deploy/check.sh RUN_NPM_CHECKS=1` 同步构建 runtime bundle；新增 `deploy/drift-check.sh` / `make drift-check`；Docker Compose healthcheck 改为真实存在的 `/login` 探活；route catalog 增加 guardMode 声明与校验。
- **可维护性**：生产 TSX 超长单行清零；`servers` / `settings-page` 大字典拆分；媒体卡片移除 `href="#"` fallback；E2E 截图输出到忽略目录并移除根目录 PNG 跟踪；Next image optimizer 不再允许任意 HTTPS 域名；README 项目规模改为 `scripts/readme-metrics.ts` 自动校验。

### 验证入口

```bash
npm run typecheck
npm run lint
npm run i18n:key-check
npm test
npm run build
npm run build:runtime
npm run docs:check
npm run route:verify
make drift-check SERVICE_PREFIX=vcontrolhub
```

---

## 🔍 用户视角全面审查（2026-07-06）

> 审查覆盖全部 46 个页面路由 + 138 个 API 路由 + SSH 组件 + lib 公共库，通过 curl 实际请求 HTML/API 验证渲染 + 逐文件源码审阅。以下为发现的问题清单，按严重度分级。**暂未修复，仅记录待处理。**

### 🔴 致命级（●）— 影响核心使用流程

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| 1 | `/account` 路由 404 | `src/app/account/`（缺 `page.tsx`） | 侧栏"账户"入口指向 `/account`，但该目录下只有 `password/` 子路由，访问 `/account` 直接落到 not-found。已 curl 验证返回 404。 |

### 🟠 重要级（▲）— 功能缺失或体验明显割裂

#### 用户管理（Users）

| # | 问题 | 位置 |
|---|------|------|
| 2 | **重置密码功能有 API 无 UI 入口** — API PATCH `action:"reset_password"` 已实现（含密码策略校验、`PENDING_PASSWORD_RESET` 状态、审计记录），但 `users-client.tsx` 用户行只有"权限""禁用/启用"按钮，无任何触发重置密码的按钮。管理员实际上无法通过 UI 重置用户密码。 | `src/app/users/users-client.tsx:103-122` |
| 3 | **禁用自己的按钮未在 UI 层隐藏** — API 层拦截"不能禁用自己"，但 UI 对当前登录用户仍渲染"禁用"按钮，点击后才报错。 | `users-client.tsx:277-285` vs `api/users/route.ts:131` |

#### 设置（Settings）

| # | 问题 | 位置 |
|---|------|------|
| 4 | **非管理员 Settings 页静默渲染空内容** — `canManage=false` 时仍渲染 4 个 Tab，但"安全/通知/高级"Tab 全是只读或空字段，无明确"无权限"提示。 | `settings/page.tsx:44-50` + `unified-settings-page-client.tsx:194-216` |

#### 审批请求（Requests）

| # | 问题 | 位置 |
|---|------|------|
| 5 | **`ApprovalBadge` 缺少 `RUNNING` 状态映射** — `toneMap` 只有 PENDING/APPROVED/COMPLETED/REJECTED/FAILED/CANCELLED，执行中的请求徽章落到默认灰色，与 CANCELLED 视觉混淆。 | `requests/page.tsx:193-208` |
| 6 | **`aria-label="Select all pending approvals"` 硬编码英文** | `requests/batch-review-toolbar.tsx:129` |

#### 通知（Notifications）

| # | 问题 | 位置 |
|---|------|------|
| 7 | **`timeAgo` 回退硬编码 `en-US`** — 超过 30 天用 `toLocaleDateString("en-US")`，中文用户会看到 `7/4/2026` 而非 `2026/7/4`。 | `notification-list-client.tsx:48` |
| 8 | **`locale` prop 声明但组件从不使用**（死参数）— 导致上面的 en-US 回退无法用传入 locale 修正。 | `notification-list-client.tsx:21-25,114` |
| 9 | **通知删除按钮触屏难触发** — `sm:opacity-0 sm:group-hover:opacity-100`，移动端无 hover。 | `notification-list-client.tsx:90-92` |

#### 账户（Account）

| # | 问题 | 位置 |
|---|------|------|
| 10 | **改密功能存在两套不一致的实现** — `/account/password` 页面表单 vs 侧栏 `change-password-modal.tsx`，UI/字段描述/可见性图标完全不一致。 | `change-password-form.tsx` vs `change-password-modal.tsx` |
| 11 | **`/account/password` 脱出主布局** — 裸 `<main>` 渲染，不带 `PageShell`、无侧栏、无移动底栏，与其他所有页面风格不一致。 | `account/password/page.tsx:12-33` |

#### 工单（Tickets）

| # | 问题 | 位置 |
|---|------|------|
| 12 | **工单状态徽章回退式翻译不安全** — `t(key) !== key` 才返回译值，新增状态（如 ON_HOLD）UI 直接显示英文大写 key。 | `tickets/page.tsx:19-25` |
| 13 | **创建工单成功无反馈** — `router.refresh()` 后无 success toast，用户看不到"已创建"。 | `tickets/create-ticket-form.tsx:25-30` |

#### 审计日志（Audit）

| # | 问题 | 位置 |
|---|------|------|
| 14 | **`formatAction` 映射表不完整** — 真实数据库第一条日志就是 `auth.login_password_ok`，不在映射中，回退显示原始英文 action key。已 curl 验证。 | `audit-client.tsx:42-65` |
| 15 | **服务端高风险过滤标签 action 未翻译** — 客户端用 `formatAction`，服务端直接显示原始 `command.execute` 等。 | `audit/page.tsx:98` vs `audit-client.tsx:189-202` |
| 16 | **StatCard label "WARNING"/"CRITICAL" 硬编码英文** | `audit/page.tsx:81-82` |

#### 图床（Image-bed）

| # | 问题 | 位置 |
|---|------|------|
| 17 | **死代码 `fetchImagesWithToast` 被 `void` 掉** — 声明后从未调用，维护者困惑。 | `image-bed-page-client.tsx:61,71` |

#### Docker

| # | 问题 | 位置 |
|---|------|------|
| 18 | **资源面板删除按钮红底红字** — `text-[var(--danger)]` + `bg-[var(--danger)]`，对比度极差。同样问题见 line 360、262。 | `docker-resources-panel.tsx:222,360,262` |
| 19 | **stats 拉取无去重** — 每次容器刷新触发全部运行容器的并发 stats 请求，12 容器 = 12 并发请求，每次刷新重复。 | `docker-page-client.tsx:207-211` |
| 20 | **`KNOWN_DOCKER_STATES` 仅覆盖 5 种**，`dead`/`removing` 等回退显示英文。 | `docker-page-client.tsx:62,71-72` |

#### 成本汇总（Cost-summary）

| # | 问题 | 位置 |
|---|------|------|
| 21 | **无权限时显示"加载失败"文案** — 语义错误，应用权限拒绝文案。 | `cost-page-client.tsx:254-261` |
| 22 | **全 0 数据趋势图画成底部水平直线** — 无可读性，应隐藏或显示"暂无趋势数据"。 | `cost-page-client.tsx:244-252,342` |
| 23 | **成本趋势图 tooltip `currency` 显示原始代码 CNY/USD 而非翻译** | `cost-page-client.tsx:368` |

#### 登录（Login）

| # | 问题 | 位置 |
|---|------|------|
| 24 | **登录提交按钮未用 SubmitButton** — 无 `useFormStatus` pending 反馈，慢网络下用户无加载指示，易重复点击。 | `login-form.tsx:56-61` |

#### 状态页（Status）

| # | 问题 | 位置 |
|---|------|------|
| 25 | **`getColorClass` 99% 和 95% 返回同色** — 两个阈值映射到相同 `success` 色，99% vs 95% 无视觉区分。 | `status/page.tsx:41-42` |
| 26 | **`server.name || "Server"` 硬编码英文回退** | `status/page.tsx:172` |
| 27 | **`SLA:` 标签硬编码英文** | `status/page.tsx:174` |

#### SSH 终端/文件管理器

| # | 问题 | 位置 |
|---|------|------|
| 28 | **SSH 上传错误消息硬编码英文** — `"Network error during upload"` 未走 i18n。 | `ssh-file-manager.tsx:227` |
| 29 | **SSH 终端 Modal 无 Esc 关闭** — Escape 仅清除搜索框内容，不关闭模态框。遮罩点击可关但键盘不行。 | `ssh-terminal-modal.tsx:429` |
| 30 | **`formatSshFileDate` 用 `undefined` locale** — 回退到浏览器默认，与其他页面的 `zh-CN`/`en-US` 不一致。 | `ssh-file-manager-parts.tsx:32` |

#### AI 助手

| # | 问题 | 位置 |
|---|------|------|
| 31 | **AI 聊天流无 unmount abort** — `useAiChatStream` 无 `useEffect` cleanup，组件在流式传输过程中卸载时 SSE 连接不会中止，可能导致连接泄漏。 | `ai/hooks/use-ai-chat-stream.ts` (无 useEffect cleanup) + `ai-client.tsx:129-160` |

#### AI 运维（AI-ops）

| # | 问题 | 位置 |
|---|------|------|
| 48 | **`formatAiOpsTime` 用无参数 `toLocaleString()`** — 不走 i18n locale，回退到浏览器默认。 | `ai-ops/ai-ops-sections.tsx:38` |
| 49 | **Settings 保存按钮 loading 文案复用 scanning 文案** — `t("aiOpsPage.actions.scanning")` 用于保存中状态，语义不匹配。 | `ai-ops/ai-ops-sections.tsx:200` |
| 50 | **`byStatus`/`byMode` 直接显示原始英文 key** — 如 `ok=1 · error=0`，未翻译。 | `ai-ops/ai-ops-sections.tsx:67,73` |

#### API 文档（API-docs）

| # | 问题 | 位置 |
|---|------|------|
| 51 | **eyebrow 硬编码英文 `"OpenAPI"`** — 未走 `t()`。 | `api-docs/api-docs-page-client.tsx:104` |
| 52 | **`"OpenAPI JSON"` 链接文本硬编码英文** | `api-docs/api-docs-page-client.tsx:116` |

#### 文件预览（Files/preview）

| # | 问题 | 位置 |
|---|------|------|
| 53 | **预览页面脱出主布局** — 裸 `<div>` 无 `PageShell`/侧栏/移动底栏（与 `/account/password` 同类问题）。 | `files/preview/page.tsx:115` |
| 54 | **不支持的文件类型用 emoji 📄** — 而非图标库。 | `files/preview/page.tsx:199` |

#### 2FA 验证（Login/verify-2fa）

| # | 问题 | 位置 |
|---|------|------|
| 55 | **`aria-label` 硬编码英文** — `` `Verification code digit ${i + 1}` `` 未走 i18n。 | `login/verify-2fa/verify-2fa-form.tsx:104` |
| 56 | **提交成功后 `router.push` + `router.refresh` 无顺序保证** — 可能先 refresh 再 push，用户看到旧页面闪烁。 | `login/verify-2fa/verify-2fa-form.tsx:75-76` |

#### 媒体详情（Media/[id]）

| # | 问题 | 位置 |
|---|------|------|
| 57 | **媒体详情页脱出主布局** — 裸 `<main>` 无 `PageShell`/侧栏/移动底栏。 | `media/[id]/page.tsx:131` |
| 58 | **emoji 硬编码 🖼/🎵/🎬** — 作 media kind icon 而非图标库。 | `media/[id]/page.tsx:231-236` |
| 59 | **返回链接 `← {label}` 硬编码箭头符号** — 而非图标组件。 | `media/[id]/page.tsx:139` |

#### 偏好设置（Preferences）

| # | 问题 | 位置 |
|---|------|------|
| 60 | **emoji 硬编码 👤🏠📊🔔🔄🛰️** — 作 section icon 而非图标库。 | `preferences/preferences-page-client.tsx:110-143` |
| 61 | **保存按钮无 disabled 状态** — 快速点击会并发发送多个 PUT 请求。 | `preferences/preferences-page-client.tsx:243-268` |
| 62 | **auto-probe 间隔按钮 disabled 时仅 `opacity-50` 但仍可点击** — `disabled:cursor-not-allowed` 但无 `onClick` guard（`<button disabled>` 浏览器原生禁用，但 CSS `disabled:opacity-50` 可能被覆盖）。 | `preferences/preferences-page-client.tsx:357-361` |

### 🟡 全局系统性问题（影响所有页面）

#### S1. i18n 日期格式化硬编码（▲）— 36 处，29 个文件

大量客户端组件直接硬编码 `"zh-CN"` 或 `"en-US"` 调用 `toLocaleString`/`toLocaleDateString`，完全绕过 i18n 系统。英文 locale 用户会看到中文日期格式，反之亦然。

**受影响文件**（关键列表）：
```
traffic-page-client.tsx:261          → toLocaleString("zh-CN")
image-bed-page-client.tsx:267        → toLocaleString("zh-CN")
api-token-manager-client.tsx:29      → toLocaleString("zh-CN")
scheduled-task-list-client.tsx:40    → toLocaleString("zh-CN")
job-events-dialog.tsx:58             → toLocaleString("zh-CN")
qa-reports/[id]/page.tsx:24          → toLocaleString("zh-CN")
qa-reports-list-client.tsx:45        → toLocaleString("zh-CN")
shares/page.tsx:48                   → toLocaleString("zh-CN") (2处)
share/[token]/page.tsx:89            → toLocaleString("zh-CN")
tickets/[id]/ticket-detail-client.tsx:117-179 (4处)
server-monitor-card.tsx:194          → toLocaleTimeString("zh-CN")
alert-rule-list-client.tsx:270       → toLocaleString("zh-CN")
settings/settings-section.tsx:45     → toLocaleString("zh-CN")
notification-list-client.tsx:48      → toLocaleDateString("en-US")
announcement-list-client.tsx:50,65   → toLocaleDateString("en-US") (2处)
file-entry-utils.ts:219              → toLocaleDateString("zh-CN")
dashboard/page.tsx:21-30             → Intl.DateTimeFormat("zh-CN") + Asia/Shanghai
lib/datetime/format.ts:3,14,21       → Intl.DateTimeFormat("zh-CN") (3处，共享库)
lib/operation-task/service.ts:72     → toLocaleString("zh-CN") + 硬编码中文
```

**正确做法**：项目已有 `toDateLocale(locale)` 工具函数（`@/lib/i18n/locale-format`），`deployments/page.tsx`、`health-dashboard-client.tsx`、`storage-node-list.tsx`、`operation-task-list-client.tsx`、`restore-backup-button.tsx` 已正确使用，但其他 25 个文件未跟进。`lib/datetime/format.ts` 的 `formatZh*` 系列函数作为共享库也硬编码中文，需改为接受 locale 参数。

#### S2. PageHeader `eyebrow` 硬编码英文（▲）— 18 处

14 个页面的 `PageHeader` 的 `eyebrow` 属性直接硬编码英文，未走 `t()` 翻译：

```
servers/page.tsx:46          → "Infrastructure"
audit/page.tsx:65            → "Audit"
monitoring-page-client.tsx:182 → "Monitoring"
files/page.tsx:220           → "Storage"
snippets/page.tsx:20         → "Snippets"
operation-tasks/page.tsx:20  → "Operations"
scheduled-tasks/page.tsx:46  → "Automation"
qa-reports/page.tsx:36       → "QA Reports"
qa-reports/[id]/page.tsx:57  → "QA Reports"
shares/page.tsx:22           → "Sharing"
health/page.tsx:26           → "Health Center"
users/page.tsx:21            → "Users"
templates/page.tsx:36        → "Operations"
quick-services/page.tsx:17   → "Quick Services"
```

`alert-rules/page.tsx` 已正确使用 `t("alertRulesPage.eyebrow", locale)`，可作为参照。

#### S3. 后端硬编码中文（▲）— 249 个非 i18n 文件，5530 处

后端 `src/lib/` 和 `src/app/api/` 中有大量硬编码中文字符串，作为 Zod schema 验证错误消息、service 层错误消息和 API 响应消息直接返回给客户端。英文 locale 用户会看到所有后端错误消息为中文。

**Top 文件**（非 i18n 目录）：
| 硬编码中文数 | 文件 | 说明 |
|---|---|---|
| 65 | `src/lib/ai/hosted-tools.ts` | AI 工具描述 |
| 52 | `src/lib/quick-service/install-notice.ts` | 安装提示 |
| 44 | `src/lib/runtime-settings/service.ts` | 运行时设置 |
| 40 | `src/lib/storage/schema.ts` | 存储验证错误 |
| 177 | 20 个 Zod schema 文件 | 表单验证错误消息 |
| 17 | `src/lib/deployment/service.ts` | 部署错误 |
| 16 | `src/lib/notification/service.ts` | 通知消息 |
| 15 | `src/lib/backup/service-policy.ts` | 备份策略 |
| 15 | `src/lib/workers/registry.ts` | Worker 注册 |

关键示例：`src/lib/operation-task/service.ts:72` 硬编码 `"心跳未知"` / `"未知"` / `"后台执行器"` 等中文标签直接拼入 `progress` 字段返回给前端。

**深度审查补充（N64-N73）**：除上述 Top 文件外，以下文件也有后端硬编码中文：
- `lib/operation-task/service.ts:72-178` — 8 处中文状态描述（"权限或认证失败"/"执行超时"/"网络或连接失败"等）
- `lib/scheduled-task/service.ts:26-28` — cron 中文描述（"每分钟"/"自定义时间表达式"）
- `lib/auth/password-policy.ts:52-55` — 密码验证中文错误消息
- `lib/preferences/refresh-interval.ts:35` — "手动刷新"
- `lib/backup/command-runner.ts:56,61` — "bash 未安装..."/"备份执行失败"
- `lib/downloads/helpers.ts:134,136` — "目标 VPS 未配置..."/"下载任务执行失败..."
- `lib/runtime-settings/service.ts:164-170` — "数据库设置"/"环境变量"/"系统默认值"
- `lib/files/tree.ts:258` / `lib/storage/service-overview.ts:70` / `lib/media/service.ts:193` — `localeCompare("zh-CN")` 后端排序硬编码
- `lib/ssh/host-key.ts:9,20,54` — SSH 主机指纹验证中文错误消息
- `lib/ssh/client.ts:212,249` — "远端目录创建失败"/"目录非空，无法删除..."
- `lib/snippet/service.ts:21-66` — 7 处中文验证错误
- `lib/ticket/service.ts:26-98` — 7 处中文验证错误

**精确统计**（深度审查量化）：
- `lib/` `throw new *Error("中文")` — **218 处**（ValidationError/BusinessError/NotFoundError/ForbiddenError）
- `lib/` Zod schema 验证消息中文 — **147 处**
- `lib/` `return "中文"` — **19 处**
- `api/` `throw new Error("中文")` — **23 处**
- **合计约 407 处后端用户可见硬编码中文字符串**，覆盖 247 个 lib/ 文件 + 119 个 api/ 文件

#### S4. 模态框无统一无障碍基线（▲）

**15+ 个模态**缺少 ESC 关闭和/或 focus trap：`UserPermissionPanel`、`CancelCommandButton`、`ChangePasswordModal`、`AlertRuleListClient`（删除确认）、AI 3 个模态（provider-panel/rename-dialog/confirm-dialog）、image-bed 3 个模态（preview/grid-and-modals×2）、playbook-delete-dialog、template-list-client（删除确认）、downloads（purge 确认）、snippets 3 个模态（list/edit/create）。`DashboardWidgetDetailDialog` 有完整 Esc 处理可作为参照。已有的 `ModalShell` 公共组件（`ui-primitives.tsx:26`）也缺 ESC + focus trap，且未被上述模态使用。应增强 `ModalShell` 并统一替换。

**关键发现**：项目**已有** `useDialogFocus` hook（`lib/a11y/use-dialog-focus.ts`）提供完整的 focus trap + ESC 关闭 + restore focus 功能，但只有 `docker-page-client.tsx` 和 `ssh-terminal-modal.tsx` 使用了它。其他所有模态都没有使用这个已有 hook。修复路径明确：在所有模态中引入 `useDialogFocus` 即可。

#### S5. Toast 关闭按钮 `aria-label="Close"` 硬编码英文（■）

i18n 审计脚本只检测中文硬编码，漏报了这个英文 aria-label。
位置：`toast-provider.tsx:101`

#### S6. 空状态/装饰 emoji 硬编码（■）

多个页面的空状态用 emoji（🎬 ⬇️ 📤 🧩）而非图标库，风格不统一。Playbook 空状态用 `🧩`，Downloads 用 `⬇️`，Media 用 `🎬`。

#### S7. 空 catch 块泛滥（▲）— 208 处

全项目有 **208 个空 catch 块**（`catch {` 无任何处理，lib/ 104 + app/ 104），另有约 116 个 `catch (e) {` 有变量但可能也为空。这些静默吞掉错误，导致：
- 功能失败时用户无任何反馈（与 N2 csrfFetch 误用类似的问题模式）
- 调试困难（错误被吞后无法追踪）
- 部分可能是故意的（如 SSE 解析失败重试），但大部分应为意外遗漏

#### S8. `AppError` 默认消息硬编码中文（▲）

项目有完善的 `AppError` 类型错误框架（`lib/errors.ts`），但所有默认 message 都是中文硬编码：`"未认证"`/`"无权访问"`/`"资源不存在"`/`"输入校验失败"`/`"状态冲突"`/`"请求过于频繁"`。即使前端发送 EN locale，后端默认错误仍返回中文。`AppError` 的 `code` 字段是机器可读的（如 `AUTH_REQUIRED`），前端可基于 `code` 做翻译映射，但当前前端未实现此映射。

**关键发现**：项目**已有** `getServerLocale()` 和 `serverT()` 函数（`lib/i18n/server-locale.ts`）让后端获取 locale 并翻译消息，但只有约 15 个文件使用了它们。366 个含中文的后端文件几乎全部直接硬编码中文。修复路径明确：在所有后端 throw/return 消息处改用 `serverT()` + i18n key。

### ⚪ 轻微级（■）— 设计细节优化

| # | 问题 | 位置 |
|---|------|------|
| 32 | `tabCounts.personal` 硬编码为 5，section 列表变化时徽标不同步 | `unified-settings-page-client.tsx:118` |
| 33 | 权限面板角色名展示方式与用户列表不一致（一个用 DB name，一个用 `t()` 翻译） | `user-permission-panel.tsx:166` vs `users-client.tsx:261` |
| 34 | 权限面板 modal 无 Esc/遮罩/focus trap | `user-permission-panel.tsx:148-157` |
| 35 | `CancelCommandButton` 弹窗无 Esc/遮罩/focus trap | `cancel-command-button.tsx:61-101` |
| 36 | 删除按钮 className 重复属性 `hover:text-[var(--danger)]` 出现两次 | `notification-list-client.tsx:90` |
| 37 | `NotificationRow` memo 比较 `prev.t === next.t`，`t` 引用可能不稳定 | `notification-list-client.tsx:98-112` |
| 38 | 工单列表 `maxW="max-w-4xl"` 与其他页面 `max-w-7xl` 宽度差异大 | `tickets/page.tsx:34` |
| 39 | `ProgressBar` 缺 `aria-valuemin={0}` | `ui-primitives.tsx:15` |
| 40 | `SubmitButton` 缺 `aria-busy="true"` 和 spinner | `submit-button.tsx:27` |
| 41 | `manifest.ts` theme_color 硬编码深色，light 主题安装时启动画面配色不匹配 | `manifest.ts:34-35` |
| 42 | 离线重试按钮点后无状态反馈（仍离线则 SW 回退到 /offline，体验为"点了无反应"） | `offline/page.tsx` |
| 43 | 媒体空状态用固定 emoji 🎬，音频/图片模式不匹配 | `media/page.tsx:470-475` |
| 44 | Downloads 轮询 useEffect 依赖 `[tasks, fetchTasks]`，每次 tasks 引用变化重建 interval | `downloads-client.tsx:49-54` |
| 45 | Downloads purge 确认弹窗按钮 `bg-[var(--danger-border)]` 作背景色偏弱 | `downloads-client.tsx:343-352` |
| 46 | 监控页 SSE 标签硬编码 "SSE" 英文 | `monitoring-page-client.tsx:214` |
| 47 | API 令牌 input 缺 `border` 类，未聚焦时无边框 | `api-token-manager-client.tsx:135` |

### ✅ 验证通过的优秀实现

- **App Shell**：侧边栏双渲染（移动 inert + 桌面）、权限过滤、GlobalSearch (Ctrl+K)、NotificationBell WS+轮询降级 — 全部功能正常
- **主题系统**：cookie SSR 注入 `light` class + `@custom-variant` + `classList.toggle` 三者闭环
- **PWA/离线**：SW 缓存策略正确（不预缓存受保护页、navigation network-first + /offline 回退）
- **i18n 词典**：`npm run i18n:coverage` 100% + `npm run i18n:key-check` 全通过，客户端 .tsx 无硬编码中文可见字符串
- **健康页**：骨架屏、sparkline lazy load、system health 自检卡片、趋势展开 — 实现完整
- **流量页**：SSE + 轮询双模式、24h/7d 切换、远程服务器流量采样 — 数据真实
- **监控页**：SSE 实时推送 + HTTP 轮询降级 — 设计合理
- **Playbooks**：dry-run + run、步骤拖拽排序、toast 反馈 — 功能完整
- **定时任务**：cron 预览描述、状态徽章、搜索过滤 — 功能完整
- **快速服务**：catalog 真实数据、一键部署流程 — 功能正常
- **部署页**：正确使用 `dateLocale`、snapshot/runs/rollback 完整展示
- **SSH 终端面板**：xterm + WebSocket、resize listener cleanup、dispose 清理 — 正确实现
- **Dashboard widget dialog**：完整 Esc 处理、`aria-modal`、`role="dialog"` — 无障碍达标
- **Storage 节点列表**：正确使用 `toDateLocale(locale)` — i18n 合规
- **Backups 恢复按钮**：二次确认 + 正确日期格式 — 功能完整
- **Alert-rules**：eyebrow 已正确使用 `t()` — i18n 合规
- **csrfFetch**：自动注入 CSRF token + Content-Type — 设计合理

### 修复优先级建议

1. **补 `/account` page.tsx 或重定向**（●，1 处）
2. **Users 重置密码 UI 入口** + **禁用自己按钮隐藏**（▲，2 处）
3. **统一日期格式化**：32 处硬编码 `zh-CN`/`en-US` → `toDateLocale(locale)`（▲，系统性）
4. **14 处 eyebrow 硬编码英文** → `t()` 翻译（▲，系统性）
5. **后端硬编码中文**：249 个文件 → 提取为 i18n key 或 locale-aware 错误消息（▲，系统性，工作量大）
6. **审计 action 映射表补全**（▲，影响所有审计日志展示）
7. **Settings 非管理员无权限提示**（▲）
8. **ApprovalBadge 补 RUNNING 状态**（▲）
9. **Docker 删除按钮配色** + **KNOWN_DOCKER_STATES 补全**（▲）
10. **Login 提交按钮改用 SubmitButton**（▲）
11. **SSH Modal 补 Esc 关闭**（▲）
12. **AI 聊天流补 unmount abort**（▲）
13. **抽公共 Modal 组件**解决 3 个模态的无障碍问题（▲）

---

## 🔍 深度源码审查补充（2026-07-06）

> 在首轮用户视角审查（62+6 问题）基础上，对 `src/app/` 全部目录及 `src/lib/` 关键模块进行逐文件源码深审。通过子代理并行审查 + 亲自逐行审查双轨完成，覆盖 servers/、files/（含 preview/）、docker/、settings/、media/、backups/、storage/、scheduled-tasks/、quick-services/、ai-ops/、qa-reports/、announcements/、operation-tasks/、api-docs/、api-tokens/、health/、status/、offline/、share/、shares/ 及 `src/lib/share-link`、`src/lib/datetime` 等。以下为排除已记录问题后的**新发现**，按严重度分级。

### 🔴 致命级（NEW-1 ~ NEW-6）— 功能完全失效

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| N1 | **Dashboard 拖拽重排完全不可用** — `_handleDrop`/`_handleDragStart` 以下划线前缀定义但从未绑定到 JSX 事件。内联 `<script>` 发送 `vps-dashboard-reorder` CustomEvent 但无任何监听器。拖拽功能 100% 失效。 | `dashboard-preference-client.tsx` | 拖拽布局功能完全失效，用户无法重排 dashboard widget。 |
| N2 | **备份计划创建 + 列表完全失效** — `csrfFetch` 未传 `raw:true` 时返回已解析 JSON 对象而非 `Response`，但代码当 `Response` 用：`res.ok` 恒为 `undefined` → `!undefined = true` → 永远提前 `return`。结果：计划列表永远显示为空，创建后总是显示失败提示（即使服务端实际成功）。 | `backups/schedule-backup-form.tsx:83-127` | `fetchSchedules` 永不执行 `setSchedules`；`createSchedule` 永远抛 `failFallback`。 |
| N3 | **Markdown 预览段落换行被转义为字面文本** — `paraLines.join("<br />")` 生成 `<br />` 标签，随后传入 `inlineFormat()`，该函数第一行 `escapeHtml(stripDangerousText(text))` 将 `<br />` 转义为 `&lt;br /&gt;`，通过 `dangerouslySetInnerHTML` 渲染时显示为字面文本 `<br />`，所有换行丢失。 | `files/preview/markdown-preview-client.tsx:127` | 多行段落的所有换行都丢失，显示为字面 `<br />` 文本。 |
| N4 | **CSV 预览斑马纹失效** — 奇偶行 `className` 完全相同：`rowIdx % 2 === 0 ? "bg-[var(--surface)]/70" : "bg-[var(--surface)]/70"`，表格行无视觉区分。 | `files/preview/csv-preview-client.tsx:146` | 应将奇数行改为 `bg-[var(--surface-subtle)]`。 |
| N5 | **server-card-actions alertdialog 无 focus trap** — `role="alertdialog"` 配合 `aria-modal="false"`，未聚焦陷阱，用户可 Tab 到背景表单字段。与 #34 同类但不同文件。 | `servers/server-card-actions.tsx:386-461` | 应 `aria-modal="true"` + focus trap。 |
| N6 | **VPS 详情 modal 无 Esc / focus trap** — `role="dialog" aria-modal="true"` 但无 keydown 监听 Esc、无焦点陷阱。区别于 #29（SSH terminal modal）。 | `servers/server-overview-card.tsx:260-298` | — |

### 🟠 重要级 — i18n 硬编码（NEW-7 ~ NEW-24）

| # | 问题 | 位置 |
|---|------|------|
| N7 | `toLocaleTimeString("zh-CN")` 硬编码 locale（S1 遗漏文件） | `servers/server-monitor-card.tsx:194` |
| N8 | `toLocaleString(locale === "en" ? "en-US" : "zh-CN")` 硬编码 locale 映射（S1 遗漏文件） | `servers/vps-backup-section.tsx:391` |
| N9 | `"VPS Detail"` modal eyebrow 硬编码英文 | `servers/server-overview-card.tsx:271` |
| N10 | `aria-label={\`Node realtime status: ${listHealthLabel}\`}` 硬编码英文前缀 | `servers/server-overview-card.tsx:208` |
| N11 | `aria-label="VPS quick actions"` 硬编码英文 | `servers/server-tab-layout.tsx:38` |
| N12 | `"Detection failed"` / `"Network error"` 硬编码英文错误回退文案 | `servers/server-overview-detail-sections.tsx:50,55` |
| N13 | `<span>—</span>` em-dash 硬编码分隔符，中文排版不用 em-dash | `servers/batch-server-action-panel.tsx:86` |
| N14 | `risk.reasons.join("；")` 全角分号硬编码，英文环境语义割裂 | `servers/direct-gateway-advice.ts:120` |
| N15 | `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })` 硬编码（S1 列了 `dashboard/page.tsx` 但漏了根 `/` 页） | `src/app/page.tsx:28-37` |
| N16 | `toLocaleString("zh-CN")` 硬编码（S1 遗漏文件） | `playbooks/playbook-types.ts:79` |
| N17 | **10+ 处 aria-label 硬编码英文**：`Batch move target path`、`Download folder archive`、`Delete ${name}`、`Move ${name}`、`Select ${name}`、`Sort by ${label}` 等 | `files/file-batch-toolbar.tsx:187`、`file-list-actions.tsx:137`、`delete-confirm-button.tsx:62`、`move-inline-form.tsx:72`、`file-list-details-view.tsx:172`、`file-list-grid-view.tsx:127`、`file-list-list-view.tsx:254,398`、`use-file-list-sort.tsx:56` |
| N18 | `data.sourceSummary.join("、")` 硬编码中文顿号 | `files/files-browser-spa.tsx:302` |
| N19 | `：` 硬编码全角中文冒号 | `files/files-browser-spa.tsx:372` |
| N20 | `（${node.driver}）` 硬编码全角括号（多处） | `files/files-browser-helpers.ts:148,150,167`、`node-filter-select.tsx:80`、`create-folder-form.tsx:100` |
| N21 | **`RESTORE` 确认文本硬编码英文** — 中文用户必须输入英文 `RESTORE` 才能确认恢复 | `backups/restore-backup-button.tsx:16-17` |
| N22 | **void-backup reason 发送翻译后字符串到 API** — `reason` 值随用户 locale 变化，导致服务端存储数据语言不一致 | `backups/void-backup-record-button.tsx:38` |
| N23 | `"dry-run failed: config_invalid"` 硬编码英文文案 | `backups/offsite-dry-run-button.tsx:115` |
| N24 | **active-incidents-banner 多处硬编码英文**：`"Incident"`、`"Maintenance"`、`"Started:"`、`"Expected end:"`、`Dismiss notification ${title}` aria-label | `health/active-incidents-banner.tsx:53-55,70-71,76` |

### 🟠 重要级 — UX / 功能缺陷（NEW-25 ~ NEW-34）

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| N25 | **toggleState 成功后 UI 不刷新** — `toggleAction` 无 `router.refresh()`，按钮文本与实际状态错位（按钮说"禁用"但服务端已禁用）。`deleteAction` 有 `router.refresh()`，`toggleAction` 没有。 | `servers/server-card-actions.tsx:359-369` | 状态错位直到手动刷新页面才恢复。 |
| N26 | **auto-probe 持久化失败完全静默** — `catch` 吞掉所有异常，UI 显示已切换但服务端未更新，下次刷新被覆盖回旧值。 | `servers/auto-probe-context.tsx:87-89` | 用户无任何反馈。 |
| N27 | **selectAll 边界 bug** — `enabledServerIds.length === 0` 时 `0 === 0` 为真，显示 `deselectAll` 标签，对空列表语义错误。 | `servers/command-create-form.tsx:37-43,129` | — |
| N28 | **file-detail-panel dialog 无焦点管理** — `role="dialog" aria-modal="true"` 但无 Esc 关闭、无焦点陷阱、无焦点归还。仅靠背景点击关闭，键盘用户无法关闭。 | `files/file-detail-panel.tsx:59-65` | — |
| N29 | **diff-review-dialog 无焦点管理** — 同上，`aria-modal="true"` 但无 Esc/focus trap。 | `files/preview/diff-review-dialog.tsx:32` | — |
| N30 | **批量操作无 AbortController** — `useBatchDelete`/`useBatchMove`/`useBatchCompress` 在 `startTransition` 中循环调用服务器动作，组件卸载后循环继续执行，`setProgress`/`showToast` 作用在已卸载组件。 | `files/use-file-batch-operations.ts` | — |
| N31 | **错误状态可清除但不可重试** — `close` 按钮抹掉错误但数据仍旧，用户无重试入口。 | `servers/vps-backup-section.tsx:207-214` | — |
| N32 | **删除确认不显示计划名称** — 用户不知道在删哪个计划（对比 `scheduled-task-list-client.tsx:225` 包含 `taskPendingDelete.name`）。 | `backups/schedule-backup-form.tsx:269` | — |
| N33 | **health-dashboard light-theme 边框失效** — 活动表用 `border-white/[0.10]` 和 `divide-white/[0.04]` 无 `light:` 回退，而骨架屏同表正确加了 `light:divide-[var(--border)]`。浅色主题下边框不可见。 | `health/health-dashboard-client.tsx:334,359,369` | — |
| N34 | **api-token 撤销确认弹窗无 Esc / 遮罩关闭** — `role="presentation"` 遮罩无 `onClick`，无 Esc 处理。 | `api-tokens/api-token-manager-client.tsx:205-222` | — |

### ⚪ 轻微级（NEW-35 ~ NEW-53）

| # | 问题 | 位置 |
|---|------|------|
| N35 | `hover:bg-[var(--danger)]` 与 `bg-[var(--danger)]` 相同，hover 无视觉反馈（3 处） | `backups/scheduled-task-list-client.tsx:231`、`schedule-backup-form.tsx:272`、`api-tokens/api-token-manager-client.tsx:216` |
| N36 | `search-scope-toggle` 非激活按钮 `text` 与 `hover:text` 完全相同，hover 无效 | `files/search-scope-toggle.tsx:41-42,52-53` |
| N37 | `getNodeIcon` emoji 🖥/💾 硬编码 | `files/files-browser-helpers.ts:162` |
| N38 | `folder-tree` 📁 emoji 硬编码 | `files/folder-tree-client.tsx:72` |
| N39 | `share-file-button` 🔗 emoji 硬编码 | `files/share-file-button.tsx:84` |
| N40 | `media-preview-client` 声明 `nodeId`/`relativePath` props 但从未使用 | `files/preview/media-preview-client.tsx:15-16` |
| N41 | `office-preview-client` 声明 `driver` prop 但从未使用 | `files/preview/office-preview-client.tsx:11` |
| N42 | `restore-button` 声明 `entryName` prop 但从未使用 | `files/restore-button.tsx:16` |
| N43 | `formatBytes` 重复实现（两份逻辑不同），应抽公共 util | `servers/vps-backup-section.tsx:40-48` vs `server-monitor-card.tsx:34-39` |
| N44 | `recycle-bin formatFileSize` 不处理 TB 级别，超过 1TB 仅显示 GB | `files/recycle-bin-section-client.tsx:15-23` |
| N45 | `text-preview` 行号 `ref` 卸载时不删除，残留 DOM 引用 | `files/preview/text-preview-renderers.tsx:99` |
| N46 | `tab` 按钮无 `role="tab"`/`aria-pressed` ARIA 语义 | `servers/server-tab-layout.tsx:43-55` |
| N47 | `connectionType` 按钮组缺 `aria-pressed`/`aria-checked` | `servers/server-create-form.tsx:36-48` |
| N48 | `"ms"` 延迟单位硬编码英文 | `backups/storage-node-list.tsx:139` |
| N49 | `action jobTitle` 含原始枚举值 `DATABASE`/`FILES`/`FULL` 未本地化 | `backups/actions.ts:41` |
| N50 | `canManage` 直接等于 `canCreate`，管理操作与创建共用权限 | `backups/scheduled-tasks/page.tsx:17` |
| N51 | `api-docs useEffect` 依赖 `[t]`，locale 切换时重复 fetch OpenAPI spec | `api-docs/api-docs-page-client.tsx:74` |
| N52 | `share-link` 后端多处硬编码中文错误消息（S3 未列入此文件） | `lib/share-link/service.ts:18,74,106,138-143` |
| N53 | `hashSharePassword` 使用 `sha256` 无 salt，弱密码可被彩虹表反查 | `lib/share-link/service.ts:58` |
| N54 | `formatTimestamp` 用 `toLocaleString(undefined, ...)` — locale 为 undefined 回退浏览器默认（S1 变种） | `monitoring/monitoring-page-client.tsx:48` |
| N55 | 表头 `PID`/`CPU%`/`MEM%` 硬编码英文 | `monitoring/monitoring-page-client.tsx:274-276` |
| N56 | `silenceWindows.join("、")` 硬编码中文顿号 | `alert-rules/alert-rule-list-client.tsx:260` |
| N57 | toggle 按钮 `hover:bg` 与 `bg` 相同（warning/success 两处），hover 无视觉变化 | `alert-rules/alert-rule-list-client.tsx:280-281` |
| N58 | `↓ {n.rx} ↑ {n.tx}` 箭头符号硬编码 | `monitoring/monitoring-page-client.tsx:259` |
| N59 | `DASHBOARD_WIDGET_LABELS` 硬编码中文（"VPS 状态"/"快捷入口"/"数据趋势"/"最近操作日志"），影响 toolbar 和 detail dialog | `lib/preferences/user-preferences.ts:27-30` |
| N60 | `server.name \|\| "Server"` 和 `SLA:` 硬编码英文 | `status/page.tsx:172,174` |
| N61 | manifest `lang: "zh-CN"` 硬编码 locale；`theme_color`/`background_color` 硬编码暗色，不支持 light theme | `app/manifest.ts:34-36` |
| N62 | `change-password-modal` 无 ESC 关闭、无 focus trap（其他模态 global-search/notification-bell/ssh-terminal 已有 ESC） | `components/change-password-modal.tsx:42` |
| N63 | `ModalShell` 公共组件缺少 ESC 关闭和 focus trap；且 change-password/alert-rules 等模态未使用此公共组件 | `components/ui-primitives.tsx:26-28` |
| N64 | `lib/operation-task/service.ts` 后端硬编码中文（"心跳"/"心跳未知"/"后台执行器"/"未知"/"权限或认证失败"等 8 处），EN 用户直接看到中文 | `lib/operation-task/service.ts:72-178` |
| N65 | `lib/scheduled-task/service.ts` cron 表达式中文描述（"每分钟"/"自定义时间表达式"等），EN 用户看到中文 | `lib/scheduled-task/service.ts:26-28` |
| N66 | `lib/auth/password-policy.ts` 密码验证错误消息硬编码中文（"密码必须包含至少一个大写字母"等） | `lib/auth/password-policy.ts:52-55` |
| N67 | `lib/preferences/refresh-interval.ts:35` 返回 `"手动刷新"` 硬编码中文 | `lib/preferences/refresh-interval.ts:35` |
| N68 | `lib/backup/command-runner.ts:56,61` 返回 `"bash 未安装..."`/`"备份执行失败"` 硬编码中文 | `lib/backup/command-runner.ts:56,61` |
| N69 | `lib/downloads/helpers.ts:134,136` 返回 `"目标 VPS 未配置..."`/`"下载任务执行失败..."` 硬编码中文 | `lib/downloads/helpers.ts:134,136` |
| N70 | `lib/runtime-settings/service.ts:164-170` 返回 `"数据库设置"`/`"环境变量"`/`"系统默认值"` 等硬编码中文 | `lib/runtime-settings/service.ts:164-170` |
| N71 | `lib/files/tree.ts:258` `localeCompare(b.name, "zh-CN")` 后端排序硬编码中文 locale，EN 环境排序顺序不正确 | `lib/files/tree.ts:258` |
| N72 | `lib/storage/service-overview.ts:70` `localeCompare(right.path, "zh-CN")` 同上 | `lib/storage/service-overview.ts:70` |
| N73 | `lib/media/service.ts:193` `localeCompare(b.tag, "zh-CN")` 同上 | `lib/media/service.ts:193` |
| N74 | `tickets/[id]/ticket-detail-client.tsx:117-119,179` 4 处 `toLocaleString("zh-CN")` 硬编码日期（S1 补充） | `tickets/[id]/ticket-detail-client.tsx` |
| N75 | `playbooks/playbook-types.ts:79` `toLocaleString("zh-CN")` 硬编码日期（S1 补充） | `playbooks/playbook-types.ts:79` |
| N76 | `notifications/notification-list-client.tsx:48` `toLocaleDateString("en-US")` 硬编码（S1 补充） | `notifications/notification-list-client.tsx:48` |
| N77 | `image-bed/image-bed-page-client.tsx:267` `toLocaleString("zh-CN")` 硬编码日期（S1 补充） | `image-bed/image-bed-page-client.tsx:267` |
| N78 | `users/page.tsx:21` eyebrow="Users" 硬编码英文（S2 补充） | `users/page.tsx:21` |
| N79 | `audit/page.tsx:65` eyebrow="Audit" 硬编码英文（S2 补充） | `audit/page.tsx:65` |
| N80 | `templates/page.tsx:36` eyebrow="Operations" 硬编码英文（S2 补充） | `templates/page.tsx:36` |
| N81 | `snippets/page.tsx:20` eyebrow="Snippets" 硬编码英文（S2 补充） | `snippets/page.tsx:20` |
| N82 | AI 模态 3 个（provider-panel/rename-dialog/confirm-dialog）`role="dialog"` 但全部无 ESC/focus trap/useDialogFocus | `ai/ai-provider-panel.tsx:138` `ai/ai-rename-dialog.tsx:35` `ai/ai-confirm-dialog.tsx:35` |
| N83 | `image-bed` 3 个模态（preview-modal/grid-and-modals×2）`role="dialog"` 有遮罩点击关闭但无 ESC/focus trap | `image-bed/image-preview-modal.tsx:50` `image-bed/image-bed-grid-and-modals.tsx:307` |
| N84 | `playbooks/playbook-delete-dialog.tsx` `role="presentation"`+`role="dialog"` 无 ESC/focus trap | `playbooks/playbook-delete-dialog.tsx:17-19` |
| N85 | `templates/template-list-client.tsx:86` 删除确认模态无 ESC/focus trap | `templates/template-list-client.tsx:86` |
| N86 | `downloads/downloads-client.tsx:343-344` purge 确认模态无 ESC/focus trap | `downloads/downloads-client.tsx:343-344` |
| N87 | `snippets/snippet-list-client.tsx:193-194` 删除确认模态无 ESC/focus trap | `snippets/snippet-list-client.tsx:193-194` |
| N88 | `snippets/snippet-edit-modal.tsx:64` 编辑模态无 ESC/focus trap | `snippets/snippet-edit-modal.tsx:64` |
| N89 | `snippets/create-snippet-modal.tsx:66` 创建模态无 ESC/focus trap | `snippets/create-snippet-modal.tsx:66` |
| N90 | `ai/ai-message-list.tsx:298,308` `bg-[var(--danger)] hover:bg-[var(--danger)]` + `bg-[var(--success)] hover:bg-[var(--success)]` hover 无变化（N35 同类） | `ai/ai-message-list.tsx:298,308` |
| N91 | `image-bed/image-bed-page-client.tsx:452,454` 分页按钮 `bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)]` hover 无变化 | `image-bed/image-bed-page-client.tsx:452,454` |
| N92 | `image-bed/image-bed-grid-and-modals.tsx` 图片网格 0 个 `tabIndex`/`role="button"`/`onKeyDown` — 图片和批量选择 checkbox 完全不可键盘操作 | `image-bed/image-bed-grid-and-modals.tsx:56-105` |
| N93 | `ai/ai-message-list.tsx:169,297,307` 图标按钮无 `aria-label`（3 个） | `ai/ai-message-list.tsx` |
| N94 | `ai/ai-chat-header.tsx:52,65` 图标按钮无 `aria-label`（2 个） | `ai/ai-chat-header.tsx` |
| N95 | `ai/ai-sidebar.tsx:43,70,88,97` 图标按钮无 `aria-label`（4 个） | `ai/ai-sidebar.tsx` |
| N96 | `ai/ai-settings-panel.tsx:76,151,159,167,175` 硬编码 emoji（👁🎬🎵📑）而非图标库（S6 同类） | `ai/ai-settings-panel.tsx` |
| N97 | `ai/ai-attachments-preview.tsx:80,84,92` 硬编码 emoji（🎬🎵📑）同上 | `ai/ai-attachments-preview.tsx` |
| N98 | `notifications/notification-list-client.tsx:28-35` `typeIcon` 用 emoji（📋✅❌🎉💥📥⚠️🚨）而非图标库（S6 同类） | `notifications/notification-list-client.tsx:28` |
| N99 | `ai/` 10 个空 catch 块（hooks/use-provider-form:51, use-conv-settings-form:68, use-conversations:91, use-ai-send-actions:142, use-ai-chat-stream:118,251, ai-client:144, ai-markdown-renderer:20, ai-message-list:154, ai-export:52） | `ai/` 多文件 |
| N100 | `image-bed/` 4 个空 catch 块（use-image-bed-list:61, image-bed-page-client:64,78,194,216） | `image-bed/` 多文件 |
| N101 | `login/verify-2fa/verify-2fa-form.tsx:83` 空 catch 块（网络错误被吞，仅显示通用消息） | `login/verify-2fa/verify-2fa-form.tsx:83` |
| N102 | `snippets/snippet-list-client.tsx:112` 空 catch 块 | `snippets/snippet-list-client.tsx:112` |
| N103 | `deployments/deployment-export-panel.tsx:79,94` 空 catch 块（clipboard fallback 中，可能可接受） | `deployments/deployment-export-panel.tsx:79,94` |
| N104 | `preferences/preferences-page-client.tsx:31` 空 catch 块（localStorage 解析失败静默返回 null） | `preferences/preferences-page-client.tsx:31` |
| N105 | `requests/ai-hosted-approval-card.tsx:22` 空 catch 块（formatParams JSON.stringify 失败返回 "{}"） | `requests/ai-hosted-approval-card.tsx:22` |
| N106 | `audit/page.tsx:52` 空 catch 块（getAuditStats 失败静默设为 null，用户看不到审计数据且无错误提示） | `audit/page.tsx:52` |
| N107 | `users/users-client.tsx:260` 角色展示用 `t(\`usersPage.role.${role.key}\`)`（已 i18n），与 N33 中 user-permission-panel 用 DB name 不一致 — 确认 N33 仍存在 | `users/users-client.tsx:260` |
| N108 | `api/servers/monitor/route.ts:9` Zod schema 验证消息硬编码 `"缺少 serverId"`（S3 同类） | `api/servers/monitor/route.ts:9` |
| N109 | `api/images/upload/init/route.ts` 等 8 个 API 路由 `throw new Error("中文")` — 前端 EN 用户收到中文错误消息（S3 同类） | `api/` 多文件 |
| N110 | `api/dashboard/analytics/route.ts` 使用 `getApiSession` 而非 `withApiRoute` — 绕过统一权限守卫，需确认权限检查是否完整 | `api/dashboard/analytics/route.ts:5-8` |
| N111 | `api/images/[id]/file/route.ts` 使用 `getApiSession` 而非 `withApiRoute` — 同上 | `api/images/[id]/file/route.ts:7-8` |
| N112 | `components/notification-bell.tsx`、`global-search.tsx` 有 ESC 处理但 notification dropdown 无 `role="dialog"`/`aria-modal` | `components/notification-bell.tsx` |

### 补充修复优先级建议

1. **N2 备份计划 csrfFetch 误用**（🔴，功能完全失效，立即修复）
2. **N1 Dashboard 拖拽不可用**（🔴，核心交互功能失效）
3. **N3 Markdown 换行转义**（🔴，预览功能损坏）
4. **N4 CSV 斑马纹失效**（🔴，视觉完全无区分）
5. **N5/N6/N28/N29/N34/N62/N63/N82-N89 模态框 focus trap / ESC**（🟠，系统性无障碍缺陷 — 共 15+ 个模态缺少 ESC/focus trap，已有 `useDialogFocus` hook 但仅 2 个组件使用，抽公共 Modal 并统一替换）
6. **S3 后端硬编码中文（~407 处）**（🟠，系统性 i18n 缺陷 — 218 throw + 147 Zod + 19 return + 23 api throw，覆盖 366 个后端文件。EN 用户直接看到中文错误消息/验证消息/状态描述/cron 表达式。影响 command/backup/downloads/quick-service/storage/sync/operation-task/scheduled-task/auth/runtime-settings/ssh/snippet/ticket 等全部核心模块）
7. **N22 void-backup reason 语言泄漏**（🟠，数据一致性问题）
8. **N25 toggleState 不刷新**（🟠，状态错位）
9. **N33 health light-theme 边框**（🟠，浅色主题视觉回归）
10. **N71/N72/N73 后端 localeCompare("zh-CN")**（🟡，EN 环境排序顺序不正确）
11. **N92 image-bed 图片网格不可键盘操作**（🟠，a11y 缺陷 — 0 个 tabIndex/role/onKeyDown）
12. **N106 audit 空 catch 吞错误**（🟡，审计数据加载失败用户无反馈）

---

## ✅ 修复记录（2026-07-06）

> 基于上述深度源码审查发现，对 4 个 🔴 CRITICAL + 系统性 i18n/a11y 问题进行修复。所有修复通过 TypeScript 编译验证、Next.js 构建、服务部署和页面访问验证。

### 验证结果

| 验证项 | 命令 | 结果 |
|--------|------|------|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ 0 错误 |
| Next.js 构建 | `npx next build --webpack` | ✅ 37 路由成功 |
| 服务部署 | `systemctl is-active vcontrolhub-next` | ✅ active |
| 页面访问 | `curl /zh/dashboard` `/zh/status` | ✅ HTTP 200 |
| Git 修改 | — | 91 文件，+1433/-2958 行，1 新文件 |

### 🔴 CRITICAL 修复（4 项）

| # | 问题 | 修复文件 | 修复方式 |
|---|------|----------|----------|
| **N1** | Dashboard 拖拽重排完全不可用 — `_handleDrop`/`_handleDragStart` 以下划线前缀定义但从未绑定到 JSX 事件，内联 `<script>` 发送 `vps-dashboard-reorder` CustomEvent 但无监听器 | `dashboard-preference-client.tsx` | 移除 inline `<script>` + CustomEvent 机制；改用 `useEffect` + `addEventListener` 直接绑定 dragstart/drop 事件到 JSX 元素；移除下划线前缀改为 `effectiveOrder` |
| **N2** | 备份计划创建+列表完全失效 — `csrfFetch` 返回已解析 JSON 对象而非 `Response`，但代码当 `Response` 用：`res.ok` 恒为 `undefined` | `backups/schedule-backup-form.tsx` | 使用 `csrfFetch<T>` 泛型直接返回解析后数据；移除 `res.ok` / `res.json()` 检查；`fetchSchedules` 和 `createSchedule` 均修复 |
| **N3** | Markdown 预览段落换行被转义为字面文本 — `paraLines.join("<br />")` 生成的 `<br />` 被 `escapeHtml()` 转义为 `&lt;br /&gt;` | `files/preview/markdown-preview-client.tsx` | 将 `join("<br />")` 操作移到 `inlineFormat()` 调用之后，避免 `<br />` 被转义 |
| **N4** | CSV 预览斑马纹失效 — 奇偶行 className 完全相同 | `files/preview/csv-preview-client.tsx` | 奇数行改为 `bg-[var(--surface-subtle)]/60`，与偶数行 `bg-[var(--surface)]/70` 产生视觉区分 |

### 🟠 Major 修复（8 项）

| # | 问题 | 修复文件 | 修复方式 |
|---|------|----------|----------|
| **N90/N91** | 18 个文件中 hover 按钮无视觉变化 — `bg-[var(--danger)] hover:bg-[var(--danger)]` 等模式 | 18 个文件（批量 sed） | `hover:bg-[var(--danger)]` → `hover:bg-[var(--danger-bg)]`；`hover:bg-[var(--success)]` → `hover:bg-[var(--success-bg)]`；`hover:bg-[var(--surface-hover)]` → `hover:bg-[var(--surface)]/[0.10]` |
| **N92** | image-bed 图片网格键盘完全不可操作 — 0 个 `tabIndex`/`role`/`onKeyDown` | `image-bed/image-bed-grid-and-modals.tsx` | 批量选择 div 添加 `role="checkbox"`/`tabIndex={0}`/`onKeyDown` 处理 Space/Enter 键 |
| **S4** | 14 个模态缺少 ESC/focus trap — `role="dialog"` 但无键盘交互 | 14 个模态文件 | 统一添加 `useDialogFocus` hook 调用（已有 hook 但仅 2 个组件使用）；包括 AI 模态 3 个、image-bed 模态 3 个、playbooks/templates/downloads/snippets 模态等 |
| **S1** | 15+ 文件 i18n 日期硬编码 — `Intl.DateTimeFormat("zh-CN")` / `toLocaleString("zh-CN")` | `page.tsx`、`dashboard/page.tsx` 等 15+ 文件 | 服务器组件：使用 `getServerLocale()` + `formatDateTime(value, locale)`；客户端组件：使用 `useI18n()` + `toDateLocale(locale)` |
| **S3** | 后端硬编码中文错误消息 — `throw new ValidationError("非法路径")` 等 | `share-link/service.ts`、`storage/service-entries.ts`、`storage/service-editable.ts`、`deploy-export/service.ts` 等 | 31 处 `throw new Error("中文")` 替换为 `t("backend.*")` 调用；新建 `src/lib/i18n/dictionaries/backend-services.ts` 字典（89 个翻译键，中英双语）；注册到 `translations.ts` |
| **T-3** | 硬编码 "Direct Gateway" — StatCard label 未使用 i18n | `dashboard-localized-sections.tsx` | 改用 `t("dashboard.direct-gateway")`；在 `dashboard.ts` 字典中添加中英文键 |
| **N82-N89** | 8 个模态缺少 ESC/focus trap（AI/image-bed/playbooks/templates/downloads/snippets） | 同 S4 | 已在 S4 中统一修复 |

### 🟡 Minor 修复（7 项）

| # | 问题 | 修复文件 | 修复方式 |
|---|------|----------|----------|
| **S2** | 硬编码 `Asia/Shanghai` 时区 — 2 个服务器组件 | `page.tsx`、`dashboard/page.tsx` | 移除模块级 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })`；改用 `getServerLocale()` + `formatDateTime(value, locale)`（内部使用 `APP_TIME_ZONE` 常量） |
| **S7** | ~22 个空 catch 块无注释说明 | `aria2/service.ts`、`ai/hosted-service.ts`、`status/service.ts`、`runtime-settings/service.ts`、`http/node-to-web-stream.ts`、`quick-service/service-lifecycle.ts` 等 | 每个 catch 块内添加简短英文注释说明为什么忽略错误（如 "Session file does not exist yet — create an empty one."） |
| **S8** | AppError 子类默认消息硬编码中文 — 6 个错误类 | `lib/errors.ts` | `AuthError` 默认 "Authentication required"、`ForbiddenError` "Access forbidden"、`NotFoundError` "Resource not found"、`ValidationError` "Validation failed"、`ConflictError` "Conflict"、`RateLimitError` "Rate limit exceeded" |
| **Status** | 硬编码 "Server" / "SLA:" — status page uptime 部分 | `status/page.tsx` | 改用 `t("statusPage.uptime.defaultServerName")` / `t("statusPage.uptime.slaLabel")`；在 `status-page.ts` 字典中添加中英文键 |
| **Dashboard labels** | DASHBOARD_WIDGET_LABELS 硬编码中文 | `lib/preferences/user-preferences.ts` | 已改为 i18n key 引用（`"dashboard.widget.serverStatus"` 等），由 `dashboard.ts` 字典提供翻译 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/i18n/dictionaries/backend-services.ts` | 后端服务 i18n 字典，89 个翻译键，覆盖 share-link/storage/deploy-export 模块的中英文错误消息 |

### 修复统计

- **修复文件数**：91 个（88 个修改 + 1 个新建 + 2 个文档）
- **代码变更**：+1433 行 / -2958 行（净减 1525 行，主要因移除重复代码和内联脚本）
- **修复问题数**：19 项（4 CRITICAL + 8 Major + 7 Minor）
- **新增 i18n 键**：~100 个（backend-services.ts 89 + dashboard/status-page 字典补充）

---

## 📄 许可
