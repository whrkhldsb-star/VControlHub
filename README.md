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
| 测试            | 365 文件 / ~2,470 tests                          |
| Docker 应用模板 | 44 (本地) + 社区源实时同步                       |
| i18n            | 142 useI18n() 调用点，76 字典文件，195 light: 语义 |

---

## 🔬 全量代码审查（2026-07-02 新一轮深度审计）

**审查范围**：~163,800 行 TypeScript/TSX，122 API 路由，46 页面，55 数据模型，1176 源文件，365 测试文件。
**方法**：三路并行子代理（后端安全 / 前端 UX / 架构基础设施）+ 交叉验证 grep 扫描 + 依赖审计 + Prisma schema 分析 + CI/CD 审查。

### 📊 现状健康评估（订正版）

| 维度 | 评分 | 说明 |
| --- | --- | --- |
| 代码质量 | 7/10 | 0 `@ts-ignore`，0 循环依赖；但 7 处 `any` 类型、6 处 `eslint-disable`、12 个文件 >500 行需拆分 |
| 认证/授权 | 7/10 | 122 路由覆盖，9 个豁免合理；但 **2 个 uptime API 完全无认证**（#25），用户角色更新缺事务（#26） |
| 安全 | 7/10 | DOMPurify 全覆盖，CSRF 防护；npm audit 0 vulnerabilities；但 SSH 客户端泄漏（#27）、login/2FA 用同步内存限流（#31）、export 缺 rate limit（#30） |
| 测试 | 6/10 | 365 文件 / ~2,470 tests pass；但 67 个 API 路由无测试、184 个 lib 文件无测试、17/29 组件无测试 |
| i18n | 5/10 | 142 useI18n() 调用点 + 76 字典文件；但 **13 个文件含大量硬编码中文**（health-dashboard 92 处、settings/field-schema 194 处、share-row-actions 0% i18n） |
| 前端 UX | 6/10 | 11 个路由缺 error.tsx + loading.tsx；0 处 React.memo；30+ 图标按钮缺 aria-label；278 处硬编码色彩类 |
| 架构 | 6/10 | **131 处 findMany 无 take 上界**（README 旧称 27/27 已接线，实际偏差大）；30+ 外键缺 @@index；45 个 @relation 无 onDelete 级联 |
| 运维 | 8/10 | systemd + caddy + smoke + 双 build 完整；CI 缺 build:runtime 步骤；无端到端测试 |
| **综合** | **6.2/10** | **结构基本健康，但存在 47 项可操作的优化空间** |

---

## 📋 优化升级待办清单（2026-07-02 审计）

### 🔴 P1 — 高优先级（影响用户体验或数据完整性）

| # | 问题 | 涉及文件 | 严重度 | 建议修复 |
| --- | --- | --- | --- | --- |
| 1 | **i18n 硬编码中文：health-dashboard** — 92 处 `zh:/en:` 双语对象未走 i18n 字典 | `src/app/health/health-dashboard-client.tsx` | Critical | 提取 healthCopy 对象到 `i18n/health-page.ts` 字典文件 |
| 2 | **i18n 硬编码中文：global-error** — 全中文页面，`html lang="zh-CN"` 硬编码 | `src/app/global-error.tsx` | Critical | 全局错误页无法用 useI18n，应双语并列显示或通过 cookie 检测 locale |
| 3 | **i18n 硬编码中文：share-row-actions** — 无 useI18n 导入，10+ 处硬编码 | `src/app/shares/share-row-actions.tsx` | Critical | 接入 useI18n + 添加 `i18n/shares-page.ts` 字典 key |
| 4 | **i18n 硬编码中文：scheduled-tasks** — 13 处表单标签和按钮文案 | `src/app/scheduled-tasks/scheduled-task-list-client.tsx` | High | 接入 useI18n |
| 5 | **i18n 硬编码中文：docker-resources** — 10+ 处含 `window.confirm("确认删除...")` | `src/app/docker/docker-resources-panel.tsx` | High | 接入 useI18n + 替换 confirm |
| 6 | **i18n 硬编码中文：team-workspace** — 15+ 处含 `confirm("确定删除团队...")` | `src/app/settings/team-workspace-section.tsx` | High | 接入 useI18n + 替换 confirm |
| 7 | **i18n 硬编码中文：settings/field-schema** — 194 处中文（最大硬编码源） | `src/app/settings/field-schema.ts` | High | 提取到 i18n 字典 |
| 8 | **i18n 硬编码中文：notification-bell** — 用 `locale === "zh" ?` 而非 i18n key | `src/components/notification-bell.tsx` | High | 迁移到 useI18n |
| 9 | **i18n 硬编码中文：global-search** — 30+ 处中文 fallback label | `src/components/global-search.tsx` | High | 迁移到 useI18n |
| 10 | **缺少 error.tsx：11 个路由** — 未捕获错误显示空白页 | `qa-reports/`, `qa-reports/[id]/`, `media/[id]/`, `tickets/[id]/`, `dashboard/`, `cost-summary/`, `ai-ops/`, `traffic/`, `share/[token]/`, `login/verify-2fa/`, `offline/` | High | 每个路由添加 `error.tsx` 错误边界 |
| 11 | **缺少 loading.tsx：同 11 个路由** — 数据加载时显示空白 | 同上 | High | 每个路由添加 `loading.tsx` 骨架屏 |
| 12 | **window.confirm 替换** — 6 处用原生 confirm 而非无障碍弹窗 | `docker-resources-panel.tsx`, `team-workspace-section.tsx`, `downloads-client.tsx`, `schedule-backup-form.tsx`, `ssh-file-manager.tsx` | High | 替换为项目已有的 `pendingDelete` + modal 模式 |

### 🟡 P2 — 中优先级（架构优化与性能提升）

| # | 问题 | 涉及文件 | 建议修复 |
| --- | --- | --- | --- |
| 13 | ✅ **findMany 无 take 上界** — 所有面向用户的 API 路由及服务函数均已添加 `take` 上界（用户列表 500、图片列表 limit、图片批量 100、图片统计 5000、uptime 90-5000、文件条目 1000、文件移动 10000）；import-service 的 ID-bounded 查询（`where: { id: { in: ids } }`）无需 take | `src/app/api/images/`, `src/app/storage/actions.ts`, `src/app/api/users/`, `src/app/api/system/uptime/`, `src/lib/storage/service-entries.ts`, `src/lib/uptime/aggregate.ts` | 已完成 |
| 14 | ✅ **外键缺 @@index：30+ 列** — 已补全所有外键 @@index（UserRole, RolePermission, SshKey, CommandApproval, ExecutionLog, FileEntry, CommandTarget, SyncLog 等）+ 迁移 | `prisma/schema.prisma` | 已完成 — `prisma/migrations/20260703090000_p2p3_add_indexes/migration.sql` |
| 15 | ✅ **@relation 无 onDelete：45 个** — 所有 @relation 均已指定 onDelete（Cascade/SetNull/Restrict） | `prisma/schema.prisma` | 已完成 |
| 16 | ✅ **N+1 查询：import-service** — 已改用 `createMany({ skipDuplicates: true })` + table-driven handler | `src/lib/system/import-service.ts` | 已完成 |
| 17 | ✅ **N+1 查询：images/batch** — 已改用 `Promise.allSettled()` 并行删除 | `src/app/api/images/batch/route.ts:66` | 已完成 |
| 18 | **React.memo 缺失：0 处** — 列表项组件无记忆化，轮询时全量重渲染 | `notifications/`, `downloads/`, `operation-tasks/`, `snippets/`, `announcements/`, `playbooks/` 等 10+ 列表页 | 提取列表项组件 + `React.memo` 包装 |
| 19 | **硬编码色彩类：278 处** — emerald/rose/amber 未用 `data-tone` | `src/components/` + `src/app/` 广泛分布 | 迁移到 `data-tone="emerald|rose|amber"` 语义属性 |
| 20 | ✅ **aria-label 缺失** — 14 个图标按钮已添加 `aria-label`（downloads-client ✕、users-client ✕、image-bed-page-client ✕、media-item-card ×、announcements 编辑、playbooks ×、snippets 复制/编辑、ssh-file-manager ✓/✕×4、vps-backup-section ✕×2）；notification-bell/docker-page/operation-tasks/ssh-terminal-manager 等已有 aria-label 或可见文本 | `notification-bell.tsx`, `downloads-client.tsx`, `docker-page-client.tsx`, `operation-task-list-client.tsx`, `ssh-file-manager.tsx`, `vps-backup-section.tsx` 等 | 已完成 |
| 21 | ✅ **SVG 缺原生 width/height** — 所有图标尺寸 SVG 已添加 `width`/`height` HTML 属性（app-sidebar 20px、change-password-modal 16px、language-toggle/theme-toggle/global-search/notification-bell 24px、ai-message-list/ai-empty-state/ai-attachments-preview 24px、icons.tsx 经 defaults() 函数统一设置）；响应式图表 SVG（sparkline/traffic-sparkline/cost-page）保持 viewBox+CSS 模式 | `language-toggle.tsx`, `global-search.tsx`, `notification-bell.tsx`, `theme-toggle.tsx`, `nav-items.tsx`, `ai/ai-message-list.tsx`, `app-sidebar.tsx`, `change-password-modal.tsx` 等 | 已完成 |
| 22 | **大文件拆分：12 个 >500 行** | `text-preview-client.tsx`(990), `playbook-list-client.tsx`(844), `files-browser-spa.tsx`(827), `ai-ops-page-client.tsx`(699), `health-dashboard-client.tsx`(674), `cost-page-client.tsx`(668), `image-bed-page-client.tsx`(653), `quick-services-client.tsx`(598), `server-overview-details.tsx`(592), `downloads-client.tsx`(565), `ssh-file-manager.tsx`(562), `ssh-terminal-modal.tsx`(530) | 按功能拆分为子组件 |
| 23 | ✅ **CI 缺 build:runtime 步骤** — 已添加 `npm run build:runtime` 步骤 | `.github/workflows/ci.yml` | 已完成 |
| 24 | ✅ **any 类型：7 处** — 非 test 代码中的 `any` 已清理（仅剩 bigint-patch.ts 的合理用法） | `src/app/status/page.tsx`, `src/app/api/system/uptime/`, `src/lib/uptime/aggregate.ts` | 已完成 |
| 25 | ✅ **🔥 uptime API 无认证** — 2 个端点已用 `withApiRoute(request, { permission: "server:read" }, ...)` 包装 | `src/app/api/servers/[id]/uptime/route.ts`, `src/app/api/system/uptime/all/route.ts` | 已完成 |
| 26 | ✅ **🔥 用户角色更新缺事务** — PATCH `/api/users` 角色更新已包入 `prisma.$transaction` | `src/app/api/users/route.ts` | 已完成 |
| 27 | ✅ **🔥 SSH 客户端泄漏** — file-proxy 和 hosted-service 的 error handler 已添加 `sshClient.end()` | `src/app/api/servers/[id]/file-proxy/route.ts`, `src/lib/ai/hosted-service.ts` | 已完成 |
| 28 | ✅ **uptime N+1 查询** — 已合并为单次 `findMany({ where: { serverId: { in: ids } } })` + 内存分组 | `src/app/api/system/uptime/all/route.ts` | 已完成 |
| 29 | ✅ **connectSsh() 重复定义 6 处** — 所有调用方已统一从 `@/lib/ssh/client` 导入 | `src/lib/ssh/client.ts` 等 6 个文件 | 已完成 |
| 30 | ✅ **export/import 缺 rate limit** — 已添加 `rateLimit: GENERAL_WRITE_LIMIT` | `src/app/api/system/export/route.ts`, `src/app/api/audit/export/route.ts` | 已完成 |
| 31 | ✅ **login/2FA 用同步内存限流** — 已改用 `checkRateLimitAsync()` | `src/app/api/login/route.ts`, `src/app/api/auth/2fa/verify-login/route.ts` | 已完成 |
| 32 | ✅ **recordJobEvent 浮动 Promise** — 6 处已通过 `safeRecordJobEvent` 包装添加 `.catch()` | `src/lib/job/service.ts` | 已完成 |
| 33 | ✅ **缺全局 unhandledRejection handler** — 已添加 `process.on("unhandledRejection"/"uncaughtException")` | `src/server.ts`, `src/ssh-ws-proxy.ts` | 已完成 |
| 34 | ✅ **export-service 加载敏感字段** — 标准模式已用 `select` 排除敏感字段（passwordHash/privateKey/apiKey 等） | `src/lib/system/export-service.ts` | 已完成 |
| 35 | ✅ **executeImport() 607 行巨函数** — 已重构为 table-driven 配置数组模式，每表一个统一 handler | `src/lib/system/import-service.ts` | 已完成 |
| 36 | ✅ **FileEntry 缺复合索引** — 已添加 `@@index([storageNodeId, entryType, isDeleted])` + `@@index([parentId])` | `prisma/schema.prisma` FileEntry 模型 | 已完成 |

### 🟢 P3 — 低优先级（技术债务与依赖更新）

| # | 问题 | 涉及文件 | 建议修复 |
| --- | --- | --- | --- |
| 37 | **测试覆盖空白：67 API 路由无测试** | `src/app/api/ai/**` (17个), `src/app/api/auth/2fa/**` (4个), `src/app/api/playbooks/**` (4个), `src/app/api/backup-schedules/**`, `src/app/api/deployments/[id]/rollback/`, `src/app/api/audit/**` 等 | 按关键路径优先补测：auth/2FA → AI → playbooks → backup → audit |
| 38 | **测试覆盖空白：184 lib 文件无测试** | `src/lib/auth/**` (11个), `src/lib/backup/**` (8个), `src/lib/ai/**` (8个) 等 | 优先补测 auth、backup、SSH 相关模块 |
| 39 | **测试覆盖空白：17/29 组件无测试** | `ui-primitives.tsx`, `page-shell.tsx`, `global-search.tsx`, `ssh-file-manager.tsx`, `ssh-terminal-panel.tsx`, `notification-bell.tsx` 等 | 优先补测 ui-primitives 和 page-shell |
| 40 | ✅ **依赖更新（部分）** — 补丁版本已完成：next 16.2.10, react 19.2.7, sharp 0.35.3, eslint-config-next 16.2.10；eslint 9→10 大版本暂缓（README 建议先跑补丁版本） | `package.json` | 补丁已完成，eslint 10 暂缓 |
| 41 | ✅ **i18n 字典文件命名不一致** — 7 组重复前缀已合并为每功能域单文件（servers, docker, monitoring, operation-tasks, scheduled-tasks, shares, users） | `src/lib/i18n/dictionaries/` | 已完成 |
| 42 | ✅ **models 缺 @@map()** — 10 个 PascalCase 模型已添加 `@@map("snake_case")`：User, Role, Permission, UserRole, RolePermission, SshKey, CommandApproval, ExecutionLog, StorageNode, FileEntry + 迁移 | `prisma/schema.prisma` | 已完成 — 全部 60 个模型均有 @@map |
| 43 | ✅ **dark: 无 light: 配对：15 处** — 已替换为 `light:` 前缀或 CSS 变量 | `notification-bell.tsx`, `snippet-list-client.tsx`, `operation-task-list-client.tsx`, `offline/page.tsx` | 已完成 |
| 44 | ✅ **dompurify 未 code-split** — 已提取到 `src/lib/sanitize/html-sanitizer.ts` 并用动态 `import()` 懒加载 | `src/app/files/preview/text-preview-client.tsx`, `markdown-preview-client.tsx` | 已完成 |
| 45 | **无端到端测试** — 仅有单元/集成测试 | 项目级别 | 可引入 Playwright 覆盖关键用户流程（登录→服务器管理→文件操作） |
| 46 | ✅ **guessContentType() 重复定义 3 处** — 已提取到 `src/lib/http/mime-types.ts` 共享 + 测试 | `src/app/api/share/[token]/route.ts`, `src/app/api/storage/sftp-download/route.ts`, `src/app/api/storage/local/route.ts` | 已完成 |
| 47 | ✅ **login/2FA/AI chat 用同步内存限流** — 已改用 `checkRateLimitAsync()` | `src/app/api/login/route.ts`, `src/app/api/auth/2fa/verify-login/route.ts`, `src/app/api/ai/chat/route.ts` | 已完成 |

---

### ⚠️ 审计订正（防止重复误报）

> 以下结论由前几轮审计反复确认，避免后续重复列入"待做"。

- **`csrf_token` cookie 不能加 `HttpOnly`** — 走 Double-Submit Cookie 模式，client 必须 `document.cookie` 读 token；加 `HttpOnly` 会直接破坏 CSRF 防护。承载身份的 session cookie 已 `httpOnly: true`，组合已满足 OWASP 推荐。`src/lib/auth/csrf-client.ts` 顶部已加 JSDoc。
- **`effect` / `@electric-sql/pglite*` 不能 `npm remove`** — 两者均为 `prisma@7.8.0` 的 transitive dependency，不在 `package.json` 顶层；验证 `npm ls effect` / `npm ls @electric-sql/pglite`。瘦身需 prisma 主动减少，非项目侧可解。
- **"4 个核心页面缺 PageHeader" 假阳性** — `/ai` 是聊天 UI、`/storage` 只 redirect、`/media` 与 `/image-bed` 已具备 eyebrow/title/description（自定义 hero header），无需补齐。
- **`/offline` 是客户端页面无服务端 guard** — 合理设计：离线页需在无网络时渲染，不能依赖服务端 session。
- **`bg-black/60` modal 背景在浅色模式下也合理** — 黑色半透明遮罩在深色/浅色主题下均为通用模式，无需额外适配。
- **`window.confirm` 中 ssh-file-manager 和 backups 已用 i18n key** — 但仍应替换为无障碍弹窗组件（P1-#12）。

## 📄 许可
