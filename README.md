<div align="center">

# 🖥️ VPS 统一管控平台

**一站式 VPS 管理 · SSH 终端 · 分布式云盘 · 应用商店 · 智能运维**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react.dev)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791?logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.8-2D3748?logo=prisma.io)](https://www.prisma.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker.com)](https://www.docker.com/)
![License](https://img.shields.io/badge/License-Private-red)

</div>

---

## 🌟 项目简介

一个面向个人和小团队的 **VPS 全生命周期管理平台**，将服务器管理、远程终端、文件操作、应用部署、监控告警和 AI 助手整合在统一 Web 界面中。开箱即用，一条命令完成部署。

> 🎯 **核心理念**：把分散的 SSH 客户端、文件管理器、Docker 面板、监控工具 → 统一到一个浏览器标签页

---

## ✨ 功能全景

> 能力边界与有意不做项见文末「[当前状态与路线](#-当前状态与路线)」。


### 🖧 服务器管理

- **多节点纳管** — 添加/管理多台 VPS，SSH 密钥认证
- **多 Tab SSH 终端** — WebSocket 实时终端，支持多 tab 多会话并行连接，Ctrl/Cmd+Tab 切换，状态指示灯实时反馈
- **SFTP 文件传输** — 终端面板内嵌 SFTP 文件管理器，拖拽上传/下载/删除/重命名/新建文件夹，面包屑导航
- **批量命令** — 服务器多选 + 批量 SSH 命令执行
- **审批流执行** — 敏感操作需管理员审批后才执行，全程审计

### 📁 分布式云盘

- **多节点挂载** — LOCAL/SFTP 统一浏览、上传/下载、回收站与分享
- **断点续传 / 版本历史** — 大文件分片续传；覆盖前自动快照，可恢复
- **WebDAV** — `/api/webdav/{nodeId}`，Bearer/Basic API Token，可挂载客户端
- **在线预览与检索** — 预览常见格式；LOCAL/SFTP 全文检索
- **媒体库 / 图床 / Aria2** — 媒体聚合、外链发布、下载中心

### 🐳 应用商店与 Docker

- **Quick Services** — 44+ 模板；可安装到**本机或远程 VPS**
- **Compose 项目生命周期** — 按项目 ps/up/down/start/stop/restart（CLI 优先，Engine 标签回退）
- **社区源 / 端口分配** — 第三方源同步；智能分配端口

### 📊 监控与告警

- **舰队监控** — 远程节点资源；后台 `health.sample` 采样与历史
- **容量预测** — 跨节点 CPU/内存/磁盘趋势，估算逼近 85%/95% 天数
- **告警** — 阈值/冷却/静默；多级升级、值班路由、事件确认
- **通知中心** — 站内 + 邮件/Telegram/Webhook 等渠道

### 🤖 AI 助手

- **多模型 + 受控工具** — OpenAI / Anthropic / 本地；VPS/日志/Docker/文件等 hosted tools
- **知识库 / RAG** — 文档分块入库，聊天自动检索注入
- **AI Ops** — 低风险自动动作 + 可解释报告；高风险仍需审批

### 🔐 安全与权限

- **RBAC 权限体系** — 用户 / 角色 / 权限三级管理
- **双因子认证 (2FA)** — TOTP 可选启用
- **API Token** — 外部集成 Token 生成与管理
- **操作审计日志** — 全操作留痕，可追溯
- **CSRF 防护** — 全站 CSRF Token + SameSite Cookie
- **API 限流** — 全局 + 端点级 Rate Limiting

### 🛠️ 运维工具

- **命令审批 / 模板 / Playbook** — 人在回路；Playbook durable 执行与崩溃续跑
- **定时任务** — Cron 调度 + 执行日志
- **备份** — DB/文件/全量；细粒度恢复；跨环境迁移包；演练不自动 restore
- **工单** — SLA、看板；关联 VPS/命令；与审批执行双向时间线
- **成本 / ITSM** — 预算与云账单账户（CSV/探针）；ITSM/IM 双向集成
- **部署管理** — 导出版本、重发与快照级回滚

### 🎨 用户体验

- **深色 / 浅色主题** — 默认暗色 UI，Q-layer 兼容层自动映射旧硬编码到 CSS 变量，支持浅色模式
- **多语言** — 中文 / 英文切换，78 个字典文件全覆盖
- **响应式布局** — 适配桌面、平板和移动端
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
| 健康检查     | `/health`          | 舰队健康 + 容量预测                                            |
| 知识库       | `/knowledge`       | AI RAG 文档入库与试检索                                        |
| ITSM 集成    | `/itsm`            | Slack/Telegram/钉钉/飞书等双向连接                             |

---

## 🚀 快速部署

### 前置条件

- **OS** — Debian 12 / Ubuntu 22.04+（root + systemd；一键安装基于 apt）
- **域名** — 可选（无域名时自动配置 Apache/IP 直连模式）
- **端口** — 对公网仅需 80/443（Web）；3000/3001 分别供 Next.js 与 SSH-WS 在本机回环地址监听，不应直接开放到公网

### 真正一行 fresh server 安装（推荐）

在干净 **Debian 12 / Ubuntu 22.04+ systemd** 服务器上，直接执行一行命令即可拉取仓库、安装依赖、生成生产环境变量、初始化 PostgreSQL、构建产物、写入 systemd/反向代理并启动服务（默认目录 `/opt/VControlHub`）：

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
  sudo APP_NAME="VControlHub" APP_SLUG=vcontrolhub APP_DIR=/opt/VControlHub DOMAIN=your.example.com bash
```

安装完成后如需查看自动生成的首次登录密码：

```bash
sudo /opt/VControlHub/deploy/install.sh --show-credentials
```

### 传统手动安装（保留）

```bash
# 1. 克隆代码
git clone https://github.com/whrkhldsb-star/VControlHub.git /opt/VControlHub

# 2. 运行安装器（自动安装 Node.js 22、发行版 PostgreSQL、Caddy/Apache 等依赖）
sudo APP_DIR=/opt/VControlHub /opt/VControlHub/deploy/install.sh

# 3. 可选：检查或覆盖安装器自动生成的环境变量，然后重新运行以应用修改
sudoedit /opt/VControlHub/.env.local
sudo APP_DIR=/opt/VControlHub /opt/VControlHub/deploy/install.sh
```

> 首次运行会从生产模板创建 `.env.local`，自动生成数据库密码、Session/SSH/加密密钥和管理员初始密码，并继续完成安装；请保存安装输出的管理员密码。只有需要自定义数据库、端口或外部服务时才需要手动编辑后重跑。

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
| 框架     | Next.js (App Router)                        | 16.2.10  |
| UI       | React + Tailwind CSS                        | 19 / 4   |
| 数据库   | PostgreSQL + Prisma                         | 14+（Docker 模式为 16）/ 7.8 |
| 认证     | 自定义 Session + bcryptjs                   | —        |
| SSH      | ssh2 + WebSocket                            | 1.17     |
| 下载     | Aria2 JSON-RPC                              | —        |
| 反向代理 | Caddy (自动HTTPS) / Apache                  | —        |
| 进程管理 | systemd                                     | —        |
| 容器     | Docker (应用商店)                           | —        |
| 代码量   | 以“项目规模”自动生成指标为准               | —        |

---

## 📁 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router (47 页面 + 138 API)
│   │   ├── api/                # API Routes (RESTful)
│   │   ├── servers/            # VPS 管理
│   │   ├── files/              # 文件管理
│   │   ├── quick-services/     # 应用商店
│   │   ├── monitoring/         # 监控面板
│   │   ├── ai/                 # AI 助手
│   │   └── ...                 # 其他功能模块
│   ├── components/             # 共享 UI 组件（当前自动统计 37 个）
│   └── lib/                    # 业务逻辑 + 工具库
│       ├── auth/               # 认证 & 权限（自定义 Session + bcryptjs + RBAC）
│       ├── ssh/                # SSH 客户端 + SFTP 服务
│       ├── quick-service/      # 应用商店引擎
│       ├── ai/                 # AI 服务 + 工具
│       ├── backup/             # 备份 job worker + 调度
│       ├── i18n/               # 国际化（78 字典文件）
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
├── prisma/                     # 数据库 Schema (60 模型) + 迁移
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

# 一次性代码、测试、构建、部署资产和文档质量门禁
npm run verify
```

> `npm run verify` 不启动浏览器 E2E；Playwright 需要可访问的应用和测试账号，按 `playwright.config.ts` 或设置 `PLAYWRIGHT_BASE_URL`、`E2E_USER`、`E2E_PASS` 后单独运行 `npx playwright test`。
>
> 在 systemd 服务正从当前目录运行时，`npm run build` 会拒绝直接覆盖 `.next`，避免运行进程与 Client Manifest 不一致。生产更新请使用 `sudo bash deploy.sh`；脚本会先停服务再构建，构建失败时自动恢复服务，成功后执行 smoke test。

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
| 功能页面            | 49                                               |
| API 路由文件        | 179                                              |
| 数据模型            | 73                                               |
| UI 组件           | 42                                               |
| 代码行数            | ~215,520（src 扫描）                                 |
| 测试              | 464 文件                                           |
| Docker 应用模板     | 44 (本地) + 社区源实时同步                                |
| i18n            | 229 useI18n() 调用点，81 字典文件                        |
<!-- README_METRICS_END -->

---

## 📌 当前状态与路线

> 定位：单控制台管理 **VPS + 文件 + 运维审批**；主体能力已可作主力使用。  
> 交付默认门禁：`tsc` / `lint --max-warnings=0` / i18n 成对 / RBAC 0 drift / `sudo bash deploy.sh` smoke 25/25。

### 已具备（摘要）

| 域 | 能力 |
|---|---|
| 安全 | RBAC、CSRF、限流、审计、advisory lock（restore / VPS schedule / playbook / compose / server-delete）、SSH host-key pin |
| 多租户 | 核心模型 Team scope；含图床删除关联存储节点、分享链接 fileEntry/撤销、部署/定时任务目标 VPS、下载/存储访问、SSH WS、流量历史等 |
| 远程运行时 | 远程 Docker；Quick Services 本机/VPS；Compose 项目生命周期 |
| 监控告警 | 后台采样；容量预测；**预测指标可挂告警规则**（days-to-85）；升级/值班/确认 |
| 命令 / Playbook | 审批与 durable 执行；**失败路径可观测**（job 不假成功、终端审计、结果通知、rejected target 收口） |
| 文件 | 检索、断点续传、版本历史、WebDAV；**节点间双向/镜像同步**（较新优先、调度、报告/冲突说明）；sftp-ops → `fs-backend` |
| 备份 | 细粒度恢复、演练、跨环境迁移向导（不自动 restore） |
| 工单 / AI | 双向时间线；知识库 RAG；AI Ops 安全闭环 |
| 集成 | 云账单账户（`teamId` + CSV/探针 + **HTTPS CSV URL live 导入**）；ITSM/IM 双向 |

### 审查残留（仅未闭环）

> 历史多轮深扫的已修复项已从 README 移除，避免与代码不同步。完整历史见 git log。

| 项 | 说明 |
|---|---|
| API 路由层英文 `error:` 卫生债 | 鉴权/限流等路径仍有部分英文；按模块继续 i18n |
| 平台级 job / prune 无 teamId | 有意全局（health/alert/cost 等 tick） |
| 部署模板全局共享 | 产品设计，非租户资源 |
| FE-17 多资源轮询 | **有意保持** `useVisibilityInterval`/`useRefreshInterval`；不硬套单资源 `useResourcePolling` |


## 📄 许可
