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
- **部署管理** — 版本导出 + 最近部署重发（真实回滚待补齐）
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
| 部署         | `/deployments`     | 应用部署运行记录、版本导出与最近部署重发（不是快照级真实回滚） |
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
| API 端点        | 122（withApiRoute 113 个，9 个特殊路径合理豁免） |
| 数据模型        | 55                                               |
| UI 组件         | 29                                               |
| 代码行数        | ~163,800（src 扫描）                             |
| 测试            | 388 文件 / ~2,745 tests                          |
| Docker 应用模板 | 44 (本地) + 社区源实时同步                       |
| i18n            | 142 useI18n() 调用点，76 字典文件，195 light: 语义 |

---

## 🔬 全量代码审查（2026-07-04 复审）

> 本节仅保留仍需处理的真实待办。已完成或经验证为过期/误报的条目已清理，避免重复排期。

**审查范围**：~163,800 行 TypeScript/TSX，122+ API 路由，46+ 页面，60 数据模型，1176+ 源文件，388 测试文件。
**最近验证**：`npm run typecheck` + `npm test` + `npm run lint` 已通过（388 test files / 2745 tests passed / 1 skipped，含 typecheck、lint、Next build、runtime bundle、deploy assets）。

### 📋 剩余优化待办

#### 🟡 P2 — 中优先级

| # | 问题 | 涉及文件 | 建议修复 |
| --- | --- | --- | --- |
| 1 | ✅ **`src/app/` 硬编码 tone 色彩类源码清零** — 已将运行时代码中的 `rose/amber/emerald/slate/indigo/purple/orange/...` Tailwind 色彩 utility 迁移到 `var(--*)`/`data-tone` 语义变量；当前复扫：生产 `src/app` **0 处 / 0 文件**（仅测试文件仍允许样式断言用例） | 已处理：`downloads-client.tsx`、`files/preview/*`、`notifications/notification-list-client.tsx`、`qa-reports-list-client.tsx`、`image-bed`、`docker`、`error.tsx` 等 | 后续可在确认 Q-layer 仅剩兼容价值后，逐步移除 `globals.css` 中旧色彩 shim |
| 2 | **大文件拆分未完成 — 仍有 17 个 >500 行源文件**，但部分子任务已完成：`import-executors.ts` 与 `storage/actions.ts` 已拆出，不再进入 >500 行榜单 | 当前最大：`ai-ops-page-client.tsx`(699)、`cost-page-client.tsx`(668)、`image-bed-page-client.tsx`(653)、`downloads-client.tsx`(645)、`quick-service/service-lifecycle.ts`(636)、`text-preview-client.tsx`(629) 等 | 继续按领域拆分：优先拆 UI 大组件（downloads/image-bed/text-preview）与 quick-service lifecycle |
| 3 | **大量 `.tsx` 组件仍含硬编码中文字符串** — 绕过 `t()` i18n 系统，EN locale 下直接显示中文；当前粗扫约 50 文件 / 176 行（含部分注释/常量误报），`audit/page.tsx` 已迁移到 `audit.page.*` 字典 | 当前热点：`files/file-batch-toolbar.tsx`、`requests/page.tsx`、`status/page.tsx`、`server-overview-card.tsx`、`requests/batch-review-toolbar.tsx`、`image-bed-page-client.tsx`、`files/*` 等 | 将所有 JSX 文本/错误消息迁移到 `t()` + 字典 key；`i18n:key-check` 脚本仅校验已用 key 的完整性，无法检测绕过 `t()` 的硬编码中文 |
| 4 | ✅ **inline locale UI 三元表达式已收敛** — 日期格式统一迁移到 `toDateLocale()`，错误 fallback 迁移到字典 key；当前复扫仅剩 7 处 / 4 文件，均为底层 locale/DOM 桥接或语言切换逻辑例外 | 保留例外：`locale-format.ts`、`dom-bridge.tsx`、`dom-translations.ts`、`language-toggle.tsx`；已处理：`dashboard-analytics-panel.tsx`、`health-dashboard-client.tsx`、`sparkline-chart.tsx`、`users-client.tsx`、`tickets/page.tsx`、`audit-client.tsx`、`storage-node-list.tsx`、`restore-backup-button.tsx` | 已完成；后续新增 UI 文案禁止 `locale === "zh" ? ... : ...`，日期/HTML lang 使用 helper |

#### 🟢 P3 — 低优先级

| # | 问题 | 涉及文件 | 建议修复 |
| --- | --- | --- | --- |
| 5 | ✅ **`/api/status` 路由错误处理已完成** — 当前异常路径返回 JSON 500，邻近测试已覆盖 | `src/app/api/status/route.ts`、`src/app/api/status/__tests__/route.test.ts` | 已完成，后续仅需常规维护 |
| 6 | ✅ **`t()` fallback 代码异味已清零** — 当前复扫 `t("key") === "key" ? ...` 为 0 处 | 原 `app-sidebar.tsx`、`change-password-modal.tsx`、`layout.tsx` | 已完成 |
| 7 | ✅ **input 字段缺 `<label>`/`aria-label` 已完成** — 已为明确可交互输入补齐可访问名，并把 `aria-label` 放在事件处理器前避免扫描误判；当前精扫仅剩 2 处 / 2 文件，均为通用 Input 封装例外，实际由调用方通过 `id`/`aria-*` props 传入 | 已处理：`ssh-file-manager.tsx`、`sortable-step-card.tsx`、`step-config-editor.tsx`、`vps-backup-section.tsx`、`share-file-picker.tsx`、`verify-2fa-form.tsx`、`media-item-card.tsx`、`image-bed-page-client.tsx`、`docker-resources-panel.tsx`、`ai-settings-panel.tsx`、`ai-attachments-preview.tsx`、`audit-client.tsx`、`team-workspace-section.tsx`、`files/*`；保留封装例外：`ui-primitives.tsx`、`input-base.tsx` | 已完成；后续新增 input 必须由可见 label 或 aria props 提供可访问名 |
| 8 | ✅ **aria-label 硬编码中文已完成** — 生产代码 `aria-label` 行中文复扫仅剩 1 处注释误报，无真实中文 aria-label | 已处理：`mobile-nav.tsx`、`image-preview-modal.tsx`、`verify-2fa-form.tsx`、`operation-task-list-client.tsx`、`server-tab-layout.tsx`、`server-overview-card.tsx`、`files/*` 等 | 已完成；后续与 P2 #3 i18n 字符串收敛分开跟踪 |
| 9 | ✅ **生产组件直接 `console.*` 已清零** — PWA 注册和 error boundary 已改用统一 `createLogger()`；当前复扫仅剩 `lib/logging.ts` 自身 3 处实现例外 + 测试 fixture 字符串 1 处 | 已处理：`pwa-register.tsx`、`route-error.tsx`、`global-error.tsx`、`error.tsx`；保留：`lib/logging.ts` | 已完成；后续新增日志统一走 `createLogger(scope)` |

### ✅ 已完成项（2026-07-04 复审确认）

- **P1-1 health-dashboard i18n** — `system-health/service.ts` 已返回结构化 `messageCode` + `params`，前端通过 `t()`/`tt()` + `health-page` 字典渲染。可选清理：`service.ts` 中残留的 dead `label`/`message` 中文 fallback 字段可删除（客户端不再读取）。
- **P1-2 settings/field-schema i18n** — schema 仅保留 `settingsClient.*` i18n key 与约束；`field-schema-i18n.ts` 桥接层已删除；validate 函数返回结构化 `FieldValidationError { key, params }`。
- **P2-3 React.memo** — `notifications`、`downloads`、`operation-tasks`、`snippets`、`announcements`、`playbooks` 6 个列表页均已提取 `memo` 列表项组件 + 自定义比较器 + `useCallback` 稳定回调。
- **P3-6 API 路由测试** — auth/2FA、AI、playbooks(含 dry-run)、backup、audit、deployment rollback 关键路径均已覆盖邻近测试。
- **P3-7 lib 测试** — auth、backup、SSH/storage、sanitize、runtime settings 高风险模块均已覆盖。
- **P3-8 组件测试** — `ui-primitives`、`page-shell`、`ssh-file-manager`、`ssh-terminal-panel`、`theme-toggle`、`toast-provider` 均已覆盖。
- **P3-9 E2E 测试** — Playwright 已引入，`e2e/` 含 `public-smoke.spec.ts`、`authenticated-flow.spec.ts`、`screenshot.spec.ts`，覆盖登录→服务器→设置等关键路径。

### ⚠️ 审计订正（防止重复误报）

- **`global-error.tsx` i18n 已完成且不能用 `useI18n()`** — App Router 的 `global-error` 渲染在 provider tree 外，当前通过 `vps-locale` cookie 检测 locale 并内置中英 copy，是合理实现。
- **`error.tsx` / `loading.tsx` 缺失项已完成** — 原清单 11 个路由均已具备对应边界/骨架文件。
- **`window.confirm` 目标项已完成** — 原目标文件中的原生 `confirm()` 已清零（2026-07-04 复审确认零匹配）。
- **`notification-bell` / `global-search` / `share-row-actions` / `scheduled-tasks` / `docker-resources` / `team-workspace` i18n 已完成** — 已接入 `useI18n` 或等价字典化路径，旧清单不再保留。
- **`csrf_token` cookie 不能加 `HttpOnly`** — 走 Double-Submit Cookie 模式，client 必须 `document.cookie` 读 token；加 `HttpOnly` 会直接破坏 CSRF 防护。承载身份的 session cookie 已 `httpOnly: true`，组合已满足 OWASP 推荐。
- **`effect` / `@electric-sql/pglite*` 不能 `npm remove`** — 两者均为 `prisma` 的 transitive dependency，不在 `package.json` 顶层；瘦身需 prisma 主动减少，非项目侧可解。
- **"4 个核心页面缺 PageHeader" 假阳性** — `/ai` 是聊天 UI、`/storage` 只 redirect、`/media` 与 `/image-bed` 已具备 eyebrow/title/description（自定义 hero header），无需补齐。
- **`/offline` 是客户端页面无服务端 guard** — 合理设计：离线页需在无网络时渲染，不能依赖服务端 session。
- **`bg-black/60` modal 背景在浅色模式下也合理** — 黑色半透明遮罩在深色/浅色主题下均为通用模式，无需额外适配。
- **`import-service.ts` 已从 500+ 行降至 13 行 barrel** — 但实现逻辑迁移至 `import-executors.ts`(1104行)，拆分效果为负；需继续拆分（见 P2 #2）。
- **Q-layer CSS 兼容层已补偿 `src/app/` 残留色** — `globals.css` ~820-1150 行将旧 `text-rose-*`/`bg-emerald-*` 等映射到 `var(--*)`，运行时主题一致，但源码未清理（见 P2 #1）。

## 📄 许可
