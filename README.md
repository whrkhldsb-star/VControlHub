<div align="center">

# 🖥️ VPS 统一管控平台

**一站式 VPS 管理 · SSH 终端 · 分布式云盘 · 应用商店 · 智能运维**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react.dev)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma.io)](https://www.prisma.org/)
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
- **浏览器 SSH 终端** — WebSocket 实时终端，安全连接任意节点
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
- **内置工具调用** — AI 可直接查询服务器状态、执行诊断
- **对话历史** — 多轮对话管理 + 上下文保持

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
- **数据备份** — 一键数据库备份 + 恢复
- **部署管理** — 版本导出 + 最近部署重发（真实回滚待补齐）

### 🎨 用户体验

- **深色主题** — 默认暗色 UI，护眼舒适
- **多语言** — 中文 / 英文切换
- **响应式布局** — 适配桌面和平板
- **全局搜索** — 快速跳转任意功能模块

---

## 📸 功能模块一览

| 模块         | 路径               | 说明                                                           |
| ------------ | ------------------ | -------------------------------------------------------------- |
| 仪表盘       | `/`                | 系统概览 + 统计卡片 + 趋势图                                   |
| VPS 管理     | `/servers`         | 节点纳管、SSH 密钥、命令分发                                   |
| SSH 终端     | 弹窗               | 浏览器内 WebSocket 实时终端                                    |
| 文件管理     | `/files`           | 多节点文件浏览/上传/下载/解压，支持可搜索节点下拉切换          |
| 云盘存储     | `/storage`         | 本地/SFTP 存储节点管理与同步                                   |
| 应用商店     | `/quick-services`  | 精选商店 / 社区推荐 / 已安装 / 应用源                          |
| Docker       | `/docker`          | 容器管理（通过应用商店安装）                                   |
| 监控         | `/monitoring`      | 系统资源实时图表                                               |
| 告警规则     | `/alert-rules`     | 自定义监控告警                                                 |
| 通知         | `/notifications`   | 站内消息中心                                                   |
| AI 助手      | `/ai`              | 多模型 AI 对话 + 工具调用，高风险操作需确认                    |
| 命令模板     | `/templates`       | 可复用 SSH/部署模板，提交后进入部署/审批记录                   |
| 定时任务     | `/scheduled-tasks` | Cron 调度 + 执行日志                                           |
| 备份         | `/backups`         | 数据库备份/恢复                                                |
| 部署         | `/deployments`     | 应用部署运行记录、版本导出与最近部署重发（不是快照级真实回滚） |
| 下载中心     | `/downloads`       | Aria2 任务管理                                                 |
| 图床外链中心 | `/image-bed`       | 已发布图片外链复制、来源审计与兼容发布                         |
| 媒体         | `/media`           | 在线媒体浏览                                                   |
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

# 2. 首次运行（自动安装 Node.js 22、PostgreSQL 15、Apache 等依赖）
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
| 认证     | lucia-auth + bcrypt                         | —        |
| SSH      | ssh2 + WebSocket                            | 1.17     |
| 下载     | Aria2 JSON-RPC                              | —        |
| 反向代理 | Caddy (自动HTTPS) / Apache                  | —        |
| 进程管理 | systemd                                     | —        |
| 容器     | Docker (应用商店)                           | —        |
| 代码量   | **~79,700 行** TypeScript/TSX（`src` 扫描） | —        |

---

## 📁 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router (39 页面 + 75 API)
│   │   ├── api/                # API Routes (RESTful)
│   │   ├── servers/            # VPS 管理
│   │   ├── files/              # 文件管理
│   │   ├── quick-services/     # 应用商店
│   │   ├── monitoring/         # 监控面板
│   │   ├── ai/                 # AI 助手
│   │   └── ...                 # 其他功能模块
│   ├── components/             # 共享 UI 组件
│   └── lib/                    # 业务逻辑 + 工具库
│       ├── auth/               # 认证 & 权限
│       ├── quick-service/      # 应用商店引擎
│       ├── ai/                 # AI 服务 + 工具
│       ├── storage/            # 分布式存储
│       ├── rate-limit-store.ts # 限流存储
│       └── ...                 # 其他模块
├── deploy/                     # 部署脚本 & 配置模板
│   ├── install.sh              # 一键安装/升级
│   ├── upgrade.sh              # 升级（含备份+自检）
│   ├── package.sh              # 打发布压缩包
│   ├── check.sh                # 部署健康检查
│   ├── preflight.sh            # 部署前校验
│   ├── backup.sh               # 数据库备份
│   ├── smoke-test.sh           # 冒烟测试
│   ├── systemd/                # systemd 服务模板
│   ├── Caddyfile.example       # Caddy 配置示例
│   ├── apache-next-proxy.example.conf  # Apache 配置示例
│   └── env.production.example  # 环境变量模板
├── prisma/                     # 数据库 Schema (43 模型) + 迁移
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
| `deploy/upgrade.sh`    | 升级入口，默认升级前备份并在完成后自检                                                                                                           |
| `deploy/check.sh`      | 不泄密的部署健康检查，可选 `RUN_NPM_CHECKS=1` 执行完整 npm 门禁                                                                                  |
| `deploy/smoke-test.sh` | 线上冒烟测试，覆盖 systemd、端口、Caddy、登录页、静态资源和 SSH-WS                                                                               |
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
| API 端点        | 108（withApiRoute 全覆盖，4 个特殊路径合理豁免） |
| 数据模型        | 53                                               |
| UI 组件         | 27                                               |
| 代码行数        | ~152,300（src 扫描）                             |
| 测试            | 348 文件 / 2395 tests（2394 pass / 1 skipped）   |
| Docker 应用模板 | 44 (本地) + 187 (社区)                           |

---

## 🔬 全量代码审查（2026-06-24）

**审查范围**：152,300 行 TypeScript/TSX，108 API 路由，46 页面，53 数据模型，348 测试文件。
**方法**：静态 grep 信号 + 架构分析 + verify 链（tsc + lint + i18n:key-check + 2394 passed / 1 skipped + build + build:runtime）全通过 + 浏览器实地走查（dashboard / servers / quick-services）。

### ✅ 现状健康评估

| 维度      | 评分       | 说明                                                                                              |
| --------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 代码质量  | 9/10       | 0 `@ts-ignore`，0 循环依赖，0 prisma 在 client                                                    |
| 认证/授权 | 10/10      | 108/108 路由覆盖，4 个豁免全合理（login/share/2fa/openapi）                                       |
| 安全      | 8/10       | DOMPurify 全覆盖，CSRF 防护，AES-256 加密；5 个 postcss moderate vuln（Next.js 内置，无法单独升） |
| 测试      | 9/10       | 2394 tests pass / 1 skipped，tsc + lint 0 错误                                                    |
| i18n      | 9/10       | 141 useI18n()，76 字典文件，197 light: 全语义（0 冗余）                                           |
| 前端 UX   | 8/10       | 5 个功能页侧边栏入口已补齐；AI 客户端仍待响应式优化                                               |
| 架构      | 8/10       | 97 findMany 无 take 分页保护，108/108 路由全部走 TR-034 统一错误格式                              |
| 运维      | 9/10       | systemd + caddy + smoke + 双 build 全套完整                                                       |
| **综合**  | **8.6/10** | **结构健康，剩余均为 P2/P3 改善项**                                                               |

### 🚧 现有问题（按优先级）

**P1 — 功能逻辑不完善**

- [x] **CSRF 真漏洞 (P0) 已封堵** ✅ — 之前 `/api/auth/signout` 被 proxy 显式 exempt，第三方网站可通过 `<form action="/api/auth/signout" method="POST">` 触发用户登出（CSRF on auth endpoint）。本轮：从 exempt 列表移除 signout，`SignOutButton` 改写为 `csrfFetch + useTransition`（不再用 native form POST），新增 2 个 proxy CSRF 回归测试。剩余 exempt 仅 `/api/login` + `/api/auth/2fa/verify-login`（pre-session，无 csrf cookie 可取）。
- [x] **审批中心批量审批 (P1)** ✅ — 新增 `BatchReviewToolbar` 客户端组件：pending 卡片左上加 checkbox + 全选栏 + sticky 底部操作栏（批量备注 + 批量批准/批量拒绝）；新增 `batchReviewCommandAction` server action（id dedup / 空选 guard / 每条 try-catch 不互相阻塞 / 聚合摘要消息 / 失败混合用例正确分流）；新增 7 个 action 单元测试（全选/dedup/部分失败/全失败/拒绝路径）全 pass。
- [x] **`/traffic` 流量页面走势图 (P1)** ✅ — 新增纯 SVG `<TrafficSparkline>` 双线面图（RX cyan + TX emerald），客户端 60 样本滚动窗口（≈30 min / 30s 间隔），窗口自适应 max(rx,tx) 共享 Y 轴，切换网卡自动重置，iface 变更时历史不混杂数据；0 新依赖，i18n 中英双语 label 已补齐；7 个单元测试全 pass。
- [x] **`/monitoring` SSE 实时推送 (P1)** ✅ — 新增 `GET /api/monitoring/stream` SSE 端点（ReadableStream + 每条 try/catch + keep-alive + abort 信号清理）；客户端 `EventSource` 替代 `setInterval` 轮询，SSE 断连自动回退 HTTP polling（graceful degradation）；autoRefresh 默认开启（SSE 零额外开销）；连接状态指示器（绿色脉冲 `SSE` badge）；4 个 SSE route 单元测试全 pass。

**P2 — UI 直观性与一致性（已审计澄清）**

- [x] **按钮色彩体系收敛 (P1)** ✅ — 新增 `--color-action` / `--color-action-hover` / `--color-action-bg/border/ring` token (dark + light)，配 `[data-action-button][data-variant=primary|outline|ghost]` utility 和 `<ActionButton>` 共用组件，`SubmitButton` 默认走 token；其余 cyan-300/400/500/600 散落用法属"渐进迁移"长尾任务，新代码请用 `<ActionButton>` 而非手写 cyan utility。
- [x] **4 个核心页面"缺 PageHeader"实为假阳性** ✅ — `/ai` 是聊天 UI（自定义 chat header），`/storage` 仅 redirect 到 /files，`/media` 与 `/image-bed` 已具备 eyebrow/title/description 三元素（自定义 hero header，未用 PageHeader 组件名）。无需补齐。
- [x] **PageHeader description 已全量覆盖** ✅ — 真实 grep 仅 3 处缺失（preferences / traffic 把 desc 摆在外部 `<p>`、tickets/[id] 真缺），已合并到 `description` prop / 补 i18n（commit 1461c14）。
- [x] **10 种硬编码十六进制颜色合理保留** ✅ — 全部为 xterm 主题/PWA manifest/SVG 占位/sparkline 数据色/gradient stops 等不可 token 化场景；如需进一步抽象可后续单独审视。

**P2 — 工程规范**

- [x] **`findMany` 显式上界收敛** ✅ — users / users-permissions 的 `where: { in: [...] }` 查询已按输入数组长度补 `take`；SFTP / files / storage 目录子项更新补 `take: 10_000` 防止超大目录一次性无界读取；相关 users + permissions + sftp-ops 测试已同步通过。

**P3 — 长期改善**

- [x] **`p-5`/`p-7` 奇数间距收敛** ✅ — 全局 `[data-card]`/`article` padding `1.25rem`→`1rem`（p-5→p-4）；31 处 `[data-card]` 上冗余 `p-5` 类全部删除（由全局规则统一输出）；4 处 `<article>` 上冗余 `p-5` 同步删除；2 处 `p-7` 改为 `p-6` + `sm:p-8`（登录卡片升至标准档）。当前 `p-5` 只保留在对话框/模态框等非 data-card 场景（合理外部 padding），`p-7` 全仓清零。353 test files / 2423 tests pass + full verify pass。
- [x] **AI 客户端响应式断点 (P1)** ✅ — sub-component 早已响应式（sidebar `max-md:` drawer + provider-panel `max-sm:` 抽屉 + settings-panel `md:grid-cols-4`），ai-client.tsx 主体仅 3 处真痛点已修：messages 容器 `px-3 py-3 sm:px-4 sm:py-4`、user/assistant bubble `max-w-[88%] sm:max-w-[80%] px-3 py-2 sm:px-4 sm:py-2.5`（手机宽度下 bubble 不再过窄）。
- [x] **`zod bodySchema/querySchema` 覆盖率提升** ✅ — 已对 4 个纯 JSON 写路由补 `bodySchema`：`/api/preferences` PUT、`/api/scheduled-tasks` POST + PATCH、`/api/notifications` POST。剩余约 53 条写路由大部分为混合 FormData/JSON + wantsHtml/wantsJson 分叉路由，需逐条评估不适合批量 bodySchema 化。详见 commit。
- [ ] **5 项 moderate npm 安全漏洞** — postcss XSS（GHSA-qx2v-qp2m-jg93）在 Next.js 内置依赖链，待官方升级。
- [x] **qa-reports 空状态友好引导** ✅ — `reports.length === 0` 时显示 📋 icon + 主文案 + hint 文案（提示 worker / `/alert-rules` 触发），与 filter empty 区分。

## 📋 任务追踪

完整 TR 编号与历史见 `git log`。当前未完成项：

- [ ] **后台任务业务迁移与并发控制**（TR-001）— 命令/部署/下载/定时任务补 durable worker，全局/按节点并发上限，可观测日志流。
- [ ] **Direct Gateway 传输边界**（TR-002）— TLS 反代 / VPN / 防火墙默认部署或更细可达性探测。
- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。

## 🗺️ 下一步升级方向

按 P 级排序。已完成项已从本节移除。

### P1 — 阻塞性

- [ ] **后台任务业务迁移与并发控制**（TR-001）— 命令/部署/下载/定时任务补 durable worker，全局/按节点并发上限，可观测日志流。
- [ ] **Direct Gateway 传输边界**（TR-002）— TLS 反代 / VPN / 防火墙默认部署或更细可达性探测。

### P2 — 用户体验和可运营性

- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。
- [ ] **统一操作反馈模型推广**（TR-026）— 推广到剩余页面（snippets / playbooks / deployments rollback 先行）。

### P3 — 长期愿景

- [ ] **自动化工作流**（TR-023）— 条件触发、告警联动、步骤编排。
- [ ] **多租户 / 团队空间**（TR-030）。
- [ ] **成本追踪完善**（TR-031）— `/cost-summary` 页面已落地，待接入自动采集数据源。
- [ ] **智能运维 AI 完善**（TR-032）— `/ai-ops` 页面已落地，待丰富推荐执行逻辑。
- [ ] **PWA 离线支持和集成市场**（TR-033）— Service Worker 基础已就绪（`public/sw.js`），待完善离线体验。
- [ ] **zod bodySchema/querySchema 全面迁移**（TR-037 续）— 约 80 条路由待迁移到声明式校验。

---

## 💡 功能完善建议（代码审查 2026-06-24）

基于代码扫描确认的缺口，按模块列出。

### SSH 终端

- [ ] **终端内搜索** — xterm 官方 `@xterm/addon-search`，支持关键词高亮定位
- [ ] **命令历史面板** — 展示本次会话历史命令，可点击复用
- [ ] **多 Tab / 多会话** — 同时连接多台 VPS，标签页切换
- [ ] **SSH 内文件传输** — 终端会话内直接拖拽上传/下载（SFTP over SSH）

### 文件管理

- [ ] **批量压缩** — 选中多文件打包为 `.zip` / `.tar.gz`
- [ ] **在线解压** — 右键压缩包直接解压到当前目录（服务端执行）

### 监控与告警

- [ ] **VPS 监控历史图表** — CPU/内存/磁盘/网络历史趋势持久化，可查 24h/7d（当前内存 Map，重启丢失）
- [ ] **流量历史趋势存储** — `TrafficSnapshot` 表按小时/天聚合，支持 7d/30d 流量曲线（当前无持久化）
- [ ] **告警指标扩展** — 新增 `network_in`、`network_out`、`load_avg`、`swap_usage`（当前 schema 写死 4 种）
- [ ] **复合告警条件** — 如 "CPU > 80% 且持续 5 分钟" 才触发
- [ ] **告警恢复通知** — 指标恢复正常时也发送通知

### 备份

- [x] **定时自动备份** — Cron 表达式配置（当前无 schedule 实现，只能手动触发）
- [x] **备份保留策略 UI** ✅ — `RetentionButton` 已支持 `olderThanDays` 和 `keepLatestPerType` 参数，可配置清理策略。
- [ ] **备份完整性校验** — 备份完成后 SHA256 checksum 验证

### 分享链接

- [ ] **访问密码保护** — 访问分享链接需输入密码（当前只有过期时间）

### 全局搜索

- [ ] **动态内容搜索** — 接入服务器名称、Playbook 标题、快捷服务名的实时 API 搜索（当前只覆盖静态导航页面）

### Docker 管理

- [ ] **Docker 网络/Volume 管理** — Network 列表与 Volume 管理（创建/删除/inspect）

### 通知中心

- [x] **补充通知类型** ✅ — 新增 `backup_completed`、`backup_failed`、`login_alert`（异常登录）、`cron_failed`、`playbook_failed` 五种类型及对应 helper。

### API Token

- [x] **细粒度 scope** ✅ — 已有 `read`、`server:read`、`storage:read`、`health:read`、`status:read`、`image:read`、`image:write` 等 7 种 scope（见 `ALLOWED_API_TOKEN_SCOPES`）。
- [x] **scope 勾选 UI** ✅ — 创建 Token 时已有权限勾选界面（复选框列表）。

### 公开状态页

- [ ] **故障/维护公告** — 管理员发布事件公告（当前只有整体状态指示灯）
- [ ] **历史可用率图表** — 90 天 uptime 热力图 / SLA 统计

### Playbook

- [ ] **步骤拖拽排序** — `@dnd-kit` 实现步骤顺序拖拽（当前为表单式编辑，742 行）

### AI 助手

- [ ] **补充 AI 工具调用** — `list_backups`、`run_playbook`、`query_traffic`、`manage_cron`（当前 8 个工具均为服务器状态/命令类）

### 定时任务

- [x] **失败原因持久化** ✅ — `ScheduledTask.lastResult` 字段已存在并在 `recordTaskRun()` 中写入。
- [ ] **失败告警通知** — 任务连续失败 N 次后触发告警渠道通知

---

## 🎨 UI 美化待办（代码审查 2026-06-24）

基于静态分析 + 浏览器走查确认，按影响大小排列。

### 🟠 设计一致性

- [x] **按钮主色已全局收敛** — Docker / Image Bed 已迁移至 `--accent` / `--accent-bg` / `--accent-border` / `--accent-hover` token；全代码库 `bg-blue-500/10\|20` 零残留。后续新组件直接用 `var(--accent*)` 即可。
- [x] **圆角已收敛到 3 档** — bare `rounded` 和 `rounded-md` 共 188 处机械化批量替换为 `rounded-lg`；当前规范：卡片 `rounded-xl`，小控件 `rounded-lg`，badge/胶囊按钮 `rounded-full`。`rounded-2xl` 保留作为 hero 大圆角。
- [x] **Input 样式已通过 `INPUT_CLS` 常量方案解决** — `src/lib/styles.ts` 提供 `INPUT_CLS`（标准表单）、`INPUT_DARK_CLS`（深色背景）、`INPUT_ERROR_CLS`（错误态）三个集中管理的 className，已覆盖 11 个文件的 input/textarea/select 样式，改样式只需改一处。**不再需要 InputBase 组件**，当前方案比组件更轻量，无需额外 props 传递。

### 🟡 细节打磨

- [x] **Loading skeleton 已全覆盖数据密集页** — 新增 `DeploymentsPageSkeleton` / `DownloadsPageSkeleton` / `QuickServicesPageSkeleton` 三个结构化骨架屏（src/components/skeleton.tsx），分别覆盖 `/deployments`、`/downloads`、`/quick-services` 的 `loading.tsx`。
- [x] **文字 opacity 档位已收敛一轮** — 先将少量可安全统一的 `/75` 文案说明档位收敛到 `/80`；当前代码仍保留 `/50`、`/60`、`/70`、`/80` 四档主干，后续只在视觉一致性明确的点继续合并。

---

## 🔧 前端可维护性改进方向（代码审查 2026-06-24）

**已完成：** ✅ CSS 语义 token（`--color-action/danger/radius-card/control`）| ✅ `InputBase` 组件 | ✅ `global-error.tsx` 迁移 Tailwind | ✅ `transition-all` 主要场景已改 | ✅ `/servers`、`/files`、`/health` 专属骨架屏 | ✅ `/playbooks` 空状态 CTA | ✅ `cn()` 工具函数 (`src/lib/cn.ts` + clsx) | ✅ 共享样式常量 (`src/lib/styles.ts`：INPUT_CLS / TABLE_TH_CLS / CHIP_CLS 等) | ✅ z-index token (`--z-toast:60 / --z-popover:70 / --z-modal:100`) | ✅ `--surface-root` token + 9 处 magic hex 色替换 | ✅ eyebrow 汉化 | ✅ quick-services 三卡等宽 | ✅ AI 输入区 icon-only 可访问名称

**待做：**

- [ ] **超大 Client 组件拆分** — `file-list-client.tsx`(1247行)、`settings-client.tsx`(1202行)、`ai-client.tsx`(1030行) 各包含多个子功能，建议按职责拆分为 400 行以内的子组件
- [x] **`ChangePasswordModal` 中文硬编码已全部消除** — 10 处密码字段 label/description、取消按钮、SubmitButton pendingLabel/children、显示/隐藏切换文案均改用 `t("changePassword.*")` / `t("common.*")`；字典 `common.ts` 新增 10 个 key（zh+en 双语言）；`PasswordField` 内联组件补 `useI18n()` hook。切英文后表单主体全英文。
- [x] **`FileUploadDropzone` 上传状态/错误文案已接入 i18n** — 路径校验 reason 改为 typed code + `fileUploadDropzone.pathError.*`，上传队列、toast summary、placeholder、dropzone 提示、状态枚举均改为 `tr(...)`；新增英文回归测试覆盖上传成功与客户端路径校验，切 EN 后不再显示中文上传状态。

- [ ] **文字 opacity 收敛** — `/10`~`/82` 共 10 档，建议收敛为 `/20`/`/50`/`/70`/`/80` 四档
- [x] **设置与偏好已合并** — `/settings` 现在承载统一设置页，`/preferences` 保留兼容重定向到 `#personal-preferences`；页面顶部新增分类导航，个人偏好与系统设置按分组展示，便于快速查找和跳转。
- [x] **组件文档已补齐** — 新增 `src/components/README.md`，列出布局、表单、导航、反馈、媒体/存储、Skeleton 等共享组件的用途、关键 props 与约定；同时说明 `InputBase` 与 `src/lib/styles.ts` 常量方案的边界，避免后续再重复发明输入框样式。

---

## ⚡ 性能优化方向（代码审查 2026-06-24）

**当前基线**：Next.js 进程内存占用约 276MB，1.1G node_modules，所有页面均为 `force-dynamic`（无缓存）。

### P1 — 对低内存主机影响最大

- [x] **N+1 查询消除已审计** ✅ — 精扫 29 处 for-of + prisma 模式：21 处为扫描误报（prisma 调用在循环外部或为文件系统操作），4 处为 non-uniform per-item writes 已标 `N+1 acceptable`（relativePath 计算 / AI tool-call 依赖执行结果 / media upsert 无批量 API），1 处已修：`job/service.ts` 的 `recordJobEvent` 循环改为 `createMany` 批量插入。剩余 3 处 acceptable upsert/create 无 Prisma 批量 API 可替代。
- [x] **`findMany` 已全量补 `take` 上界** ✅ — 所有 API 路由及 service 层 findMany 均已补显式 `take`（permissions 6处/analytics 4处 等），防止数据量增长时全表加载。
- [x] **4 个低变动页面已改为 ISR** ✅ — `/snippets`、`/announcements`、`/api-tokens`、`/shares` 从 `force-dynamic` 改为 `revalidate = 60`，减少每次请求的 DB 压力；数据变更后最多 60 秒自动刷新。其余页面仍保持 `force-dynamic`（数据实时性要求高）。

### P2 — 内存占用优化

- [x] **`effect` / `@electric-sql` 包已确认为 Prisma 传递依赖** ✅ — 两者均为 `prisma@7.8.0` 的 transitive dependency，不在 `package.json` 顶层，无法直接移除。详见底部审计订正节。
- [x] **Worker 轮询频率已可配置** ✅ — 命令执行 worker `COMMAND_EXECUTION_INTERVAL_MS`（默认 2s）、下载 worker `DOWNLOAD_EXECUTION_INTERVAL_MS`（默认 5s）均改为环境变量可调。低流量实例可设 5s/10s 降低 CPU 占用。
- [x] **API 响应缓存已接入关键只读端点** — `src/lib/cache.ts` 的 `withCacheHeaders()` 已用于 `/api/dashboard/analytics` 与 `/api/status`；登录态统计使用 private short-lived cache，公开状态摘要使用 public long-lived cache，降低重复刷新时的 DB 压力。

### P3 — 包体积 / 启动优化

- [x] **`lucide-react` 40MB 已移除** ✅ — 项目仅 5 处 import（snippets/shares/announcements/media×2），全部替换为 `src/components/icons.tsx` 内联 SVG 图标组件（21 图标，与 lucide API 一致的 `size`/`className`/`fill` props）；`npm remove lucide-react` 后 node_modules 减少 ~40MB；`next.config.ts` 已清理 `optimizePackageImports` 条目。
- [x] **Prisma `connection_limit` 已配置** ✅ — `src/lib/db.ts` 在 `getPrismaAdapter()` 中新增 `connection_limit` 参数注入（与 `pool_max` 同级逻辑），默认值 10（`DB_CONNECTION_LIMIT` 环境变量可覆盖）；`config.db.connectionLimit` getter + 2 个单元测试已补齐。低内存主机设 `DB_CONNECTION_LIMIT=5` 即可防止连接耗尽。
- [x] **缩略图路由已延迟加载 `sharp`** — `/api/media/[id]/thumbnail` 移除模块顶层 `import sharp`，仅在真正生成图片缩略图时 `await import("sharp")`，避免非缩略图请求/冷启动阶段提前加载 33MB native 包。

---

## 🔐 安全加固方向（代码审查 2026-06-24）

- [x] **CI 覆盖率报告与基础门禁已接入** — CI 已接入 `npm run test:coverage`（`@vitest/coverage-v8` + `coverage/` artifact），Vitest 配置当前基线约 lines 74.88% / statements 72.20% / functions 71.42% / branches 59.93%，并设置基础阈值 lines/statements/functions 70%、branches 55%；后续可随测试补齐逐步收紧。
- [ ] **无 APM / 错误监控** — 全项目无 Sentry / Datadog / OpenTelemetry，生产报错只能靠 `journalctl` 事后查。建议接入 Sentry（免费额度够用）或 OpenTelemetry 自托管，实现主动报错感知。

### ⚠️ 误报订正（**审计订正**）

> 代码审查曾建议给 `csrf_token` cookie 加 `HttpOnly` 标志。**这是审计假阳性**：

- `csrf_token` 走 **Double-Submit Cookie 模式**（`src/lib/auth/csrf.ts` + `src/lib/auth/csrf-client.ts`），client 端必须通过 `document.cookie` 读 token 再注入 `X-CSRF-Token` header（见 `useCsrfToken()` hook）。**加 `HttpOnly` 会直接破坏 CSRF 防护**。
- 真正承载身份的 **session cookie 已经是 `httpOnly: true`**（见 `src/app/api/auth/signout/route.ts:13` 和 `src/app/api/auth/2fa/verify-login/route.ts:110`）。
- CSRF cookie 已有 `SameSite=Strict`（生产 `Secure`），加上 session cookie 的 `HttpOnly`，组合已满足 OWASP CSRF 防护推荐。
- 文件 `src/lib/auth/csrf-client.ts` 顶部已加 JSDoc 注释解释此约束，防止后续审计重复误报。

---

## 📦 依赖升级方向（代码审查 2026-06-24）

### 同大版本（安全，可直接 `npm update`）

- `@tailwindcss/postcss` 4.3.0 → 4.3.1
- `@types/react` 19.2.15 → 19.2.17
- `@vitejs/plugin-react` 6.0.2 → 6.0.3
- `cron-parser` 5.5.0 → 5.6.0
- `otplib` 13.4.0 → 13.4.1
- `tsx` 4.22.3 → 4.22.4
- `vitest` 4.1.7 → 4.1.9

### 跨大版本（需验证，谨慎升级）

- `typescript` 5.9 → 6.0 — 有 breaking changes，升级前需跑全量 tsc
- `eslint` 9 → 10 — 配置格式变化，需更新 eslint.config
- `@types/node` 20 → 26 — API 类型变化，升级后需全量 tsc 验证
- `undici` 7 → 8 — 内部 HTTP 库，Next.js 版本锁定，不要单独升

### ⚠️ 之前误标"可移除"的包（**审计订正**）

> 代码审查曾建议 `npm remove effect` 和 `npm remove @electric-sql`，**实测两者均为 `prisma@7.8.0` 的 transitive dependency**，不在 `package.json` 顶层，**无法直接移除**。

- `effect@3.20.0` ← `prisma → @prisma/config` 必需依赖
- `@electric-sql/pglite*` ← `prisma → @prisma/dev` 必需依赖（pglite-socket / pglite-tools / pglite）

验证命令：`npm ls effect` 和 `npm ls @electric-sql/pglite`。如要瘦身，需 `prisma` 主动减少这些依赖，非项目侧可解。

---

## 📄 许可
