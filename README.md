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
| 测试            | 358 文件 / ~2,470 tests                          |
| Docker 应用模板 | 44 (本地) + 社区源实时同步                       |
| i18n            | 142 useI18n() 调用点，76 字典文件，195 light: 语义 |

---

## 🔬 全量代码审查（2026-06-30）

**审查范围**：~163,800 行 TypeScript/TSX，122 API 路由，46 页面，55 数据模型，358 测试文件。
**方法**：静态 grep 信号 + 架构分析 + verify 链（tsc + lint + i18n:key-check + 测试全通过 + build + build:runtime）+ 浏览器实地走查。

### ✅ 现状健康评估

| 维度      | 评分       | 说明                                                                                                    |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 代码质量  | 9/10       | 0 `@ts-ignore`，0 循环依赖，0 prisma 在 client                                                          |
| 认证/授权 | 10/10      | 122 路由覆盖，9 个豁免全合理（login/share/2fa/openapi/sftp-upload 等特殊流）                            |
| 安全      | 8/10       | DOMPurify 全覆盖，CSRF 防护，AES-256 加密；5 个 postcss moderate vuln（Next.js 内置，无法单独升）        |
| 测试      | 9/10       | 358 文件 / ~2,470 tests pass，tsc + lint 0 错误                                                          |
| i18n      | 9/10       | 142 useI18n()，76 字典文件，195 light: 全语义                                                            |
| 前端 UX   | 8/10       | 多 Tab SSH 终端 + SFTP 文件管理 + 浅色模式 Q-layer 兼容层                                                |
| 架构      | 9/10       | findMany take 上界全部接线（27/27），122 路由全部走 TR-034 统一错误格式，durable job worker + 定时调度   |
| 运维      | 9/10       | systemd + caddy + smoke + 双 build 全套完整 + 定时备份调度 + 异地 S3                                    |
| **综合**  | **8.8/10** | **结构健康，剩余均为 P2/P3 改善项**                                                                     |

---

## 🎨 UI 架构升级摘要

**浅色模式 Q-layer 兼容层**（globals.css L274-400 + L1571-1599）：通配符映射旧 `slate/cyan/white` 硬编码到 CSS 变量，实现深色 → 浅色自动切换。R35-R36 已将 159 文件 ~1500 处硬编码替换为显式 CSS 变量，残留由 Q-layer 兜底，**当前无可见 bug**。

**真实 bug 修复**（R33）：仪表盘时间戳截断、quick-links 磁贴压缩、CPU 型号被 `split` 截断、9 处 Tailwind 双透明度类静默丢样式、PageShell 内容宽度统一 `max-w-7xl`。

**数据获取层抽象**：`useRefreshInterval` 消除 4 处重复轮询样板；`useResourcePolling` 统一 loading/refreshing/error/data + 可见性感知轮询 + 重叠去重，audit 页 pilot 迁移完成。新页面接数据从 ~50 行手写样板降到 3 行 hook 调用。

## 📋 待办清单（统一）

> 整合原"现有问题 / 任务追踪 / 下一步升级方向 / 功能完善建议 / UI 美化 / 前端可维护性 / 性能优化 / 安全加固 / 依赖升级"九节而成。已完成项已直接删除，仅保留未完成或部分完成的真待办。每条尾部 `[tag]` 标注类别。

### P1 — 阻塞或核心

> 当前无未完成 P1。

### P2 — 用户体验与工程规范

- [x] **VPS OS 方言适配层**（TR-041）— ✅ 已实现（commit `7f7e5c0`）。新建 `src/lib/ssh/os-dialect.ts`（399 行）：`OsDialect` 类型 + 6 大发行版预设（Debian/RHEL/Alpine/Arch/SUSE/默认）+ `parseOsRelease()`/`dialectFromOsRelease()`/`detectOsDialect()` SSH 探测 + `serviceCommand()`/`packageCommand()` 方言感知命令生成 + `serialize/deserialize` 持久化。Prisma migration 添加 `Server.osDialect`（JSON）+ `Server.osInfo` 字段。新增 API `POST /api/servers/[id]/detect-os` 触发探测并存储。替换 reload 路由 + AI hosted-service 中硬编码 systemctl 为 `serviceCommand()`。UI server 详情页新增 OS 方言展示区块 + 探测按钮。34 单元测试 + 6 集成测试全部通过。 `[功能/架构]`
- [x] **VPS 远程备份**（TR-043）— 通过 SSH 在远端 VPS 执行备份，SFTP 拉回 VControlHub 存储 + 可选 S3 异地上传。6 种预设（nginx-config/mysql/postgres/docker-volumes/website-files/custom）+ cron 调度 + 保留策略 + durable job worker。`0eafe7d`
- [x] **系统配置导出 / 导入**（TR-042）— ✅ 已实现（commit `431d12a`）。已落地 `src/lib/system/export-service.ts` / `import-service.ts` / `config-schema.ts`，支持导出 `.vch.json`（schema 版本、导出时间、来源域名、敏感字段脱敏）和 zod 校验后事务性导入/预览；API：`GET /api/system/export` + `POST /api/system/import`；设置页 `SystemConfigSection` 提供数据迁移 UI（导出按钮、导入预览、确认导入）。验证：`config-schema.test.ts` + `export-service.test.ts` 共 17 测试通过。 `[功能/架构]`
- [x] **快捷服务剩余增强**（TR-011）— ✅ 已实现（commit `d8d8474`）。QuickService 安装现在同步等待 Docker 容器启动结果，失败会让后台 Job/API 真实失败而不是提前标记完成；新安装失败删除 partial `quick_services` 行，覆盖已有服务的重装失败会按完整 before snapshot 恢复旧配置。审计 diff 扩展为真实配置快照（status/port/containerId/image/path/internalPort/extraPortsJson/command/envJson/volumesJson/error），失败审计记录 rollback 状态。Direct Gateway 安装命令生成前新增 rootPath 边界校验（拒绝 `/`、相对路径、`..`/`.` 穿越）并规范化尾随 `/`。52 个目标测试 + `tsc --noEmit` 通过。 `[功能]`
- [x] **Playbook 步骤拖拽排序** — ✅ 已实现（commit `f7fbf4b`）。新增 `@dnd-kit/core` / `@dnd-kit/sortable` / `@dnd-kit/utilities`，创建 Playbook 表单的步骤列表改为 `DndContext + SortableContext`，每步卡片新增可访问拖拽手柄（指针拖拽 + 键盘排序），拖拽后直接更新 `steps` state，提交 payload 按当前顺序持久化。新增组件测试覆盖 reorder helper、拖拽手柄可访问性与提交顺序。`playbook-list-client.test.tsx` 3 测试 + `tsc --noEmit` 通过。 `[功能]`
- [x] **历史可用率图表** — 公开状态页补 90 天 uptime 热力图 / SLA 统计（commit `36428d7`）。新增 `ServerUptimeSnapshot` 模型（每日汇总 uptime，含 onlineMinutes/offlineMinutes/checkCount），迁移已应用（`20260630213935_add_server_uptime_snapshots`）。新建 `src/lib/uptime/aggregate.ts` 从 `MetricSnapshot.isOnline` 计算每日 uptime。API：`GET /api/system/uptime/all`（所有服务器 90 天数据）+ `GET /api/servers/[id]/uptime`（单台）。更新 `/status` 页面渲染 90 天热力图（含 SLA 计算 + 缺失日期 0% 填充）。新增 `UptimeHeatmap` 组件。所有类型检查通过。 `[功能]`

### P3 — 长期愿景与渐进式改善

- [ ] **自动化工作流**（TR-023）— 条件触发、告警联动、步骤编排。 `[功能]`
- [x] **多租户 / 团队空间**（TR-030）— ✅ 已实现（本提交）。新增 `Team` / `TeamMember` 模型与 `User.currentTeamId`，迁移 `20260701023000_add_team_workspaces` 已应用并生成 Prisma Client；新增团队空间 service + API：`GET/POST /api/teams`、`POST /api/teams/switch`、`POST /api/teams/[id]/members`，支持团队创建、成员添加/角色更新、当前团队切换与审计记录。设置页个人 tab 新增 `TeamWorkspaceSection`，展示团队、成员、当前团队和管理表单。新增 `src/lib/team/__tests__/service.test.ts` 覆盖创建、切换权限和成员 upsert；`tsc --noEmit` 通过。当前为多租户基础骨架，后续资源级隔离可在 Team 基础上逐表接入。 `[架构]`
- [ ] **成本追踪完善**（TR-031）— `/cost-summary` 页面已落地，待接入自动采集数据源。 `[功能]`
- [x] **智能运维 AI 完善**（TR-032）— ✅ 已实现（本提交）。`/ai-ops` 推荐执行逻辑从占位模拟改为显式安全动作执行器：新增 `src/lib/ai/ops/action-executor.ts`，`executeRecommendation()` 保持 `AI_OPS_SAFE_AUTONOMOUS_ACTIONS` 白名单校验后再执行；`alert.evaluate` 真实调用现有告警评估逻辑并写回可审计执行结果，未携带必要 payload 的安全动作（低风险 Playbook、备份元数据快照、陈旧缓存清理）不再假装成功，而是记录未执行原因。autonomous 扫描会先生成计划动作，再通过执行器落地安全动作。17 个目标测试 + `tsc --noEmit` 通过。 `[功能]`
- [ ] **PWA 离线支持和集成市场**（TR-033）— Service Worker 基础已就绪（`public/sw.js`），待完善离线体验。 `[功能]`
- [x] **浅色模式残留 Q-layer 依赖** — ✅ 已完成（commits `adb9af4` ~ `e293944`）。Phase 1-3 累计替换 139 个 .tsx 文件 ~2364 次硬编码为 CSS 变量：Phase 1（10 高频文件，315 替换）、Phase 2（44 中频文件，490 替换）、Phase 3（85 剩余文件，1559 替换）。globals.css 移除 Q-layer 规则（L274-423 + L1571-1610+，-1347 行，从 2113 行 → 766 行）。映射规则：text-white/slate-50/100/200/cyan-50/100 → text-[var(--text-primary)]；text-slate-300/400/cyan-200/white/80/white/90 → text-[var(--text-secondary)]；text-slate-500/600/cyan-200/70/white/50/60/40/70 → text-[var(--text-muted)]；bg-white/slate-950/900/800 → bg-[var(--surface)]；bg-white/[0.04-0.10] → bg-[var(--surface-elevated)]；hover:bg-white/* → hover:bg-[var(--sidebar-hover)]；border-white → border-[var(--border)]。tsc + vitest 全过，已部署。`[UI]`
- [x] **按钮 cyan 散落用法渐进收敛** — ✅ 已完成（commits `365ac50` ~ `62e747d`）。所有 `cyan-*/300/400/500/600/700/800/900/950` 手写 utility 替换为 `--color-action*` token 体系：text-cyan-400/300 → `text-[var(--color-action)]`；text-cyan-500 → `text-[var(--color-action-hover)]`；text-cyan-600/700 → `text-[var(--color-action-strong)]`；text-cyan-50/100/200 → `text-[var(--color-action-fg)]`；bg-cyan-500 → `bg-[var(--color-action)]`；bg-cyan-400/300/50/100/200 → `bg-[var(--color-action-bg)]`；bg-cyan-600/700/800/900/950 → `bg-[var(--color-action-strong)]`；border-cyan → `border-[var(--color-action-border)]`；ring-cyan → `ring-[var(--color-action-ring)]`；accent-cyan → `accent-[var(--color-action)]`。132 个文件，~750 替换。仅余 1 处代码注释。`[UI]`
- [x] **硬编码 hex 颜色** — 全部为 xterm 主题（ssh-terminal 终端配色）、PWA manifest（启动画面主题色）、SVG 占位、gradient stops 等不可 token 化场景，已确认为合理用途，无需改动。 `[UI]`
- [x] **文字 opacity 进一步合并** — ✅ 已完成（commit `ea589d0`）。7 档（/5/10/15/20/25/30/40/50/60/70/80/95）→ 4 档（low=/10, mid=/30, high=/70, full=移除 /80 与 /95）。任意透明度值同步收敛：[0.01-0.03] → [0.04]，[0.05-0.08] → [0.10]。106 个文件，420 处替换，减少浅/深色下透明层级漂移。`[UI]`
- [x] **`bg-white/[0.01/0.025/0.045]` 三个极低透明度缺 Q-layer 显式规则** — 已在 `globals.css` L1592-1596 补齐 `html.light` 显式规则。 `[UI]`
- [x] **`divide-white/` 残留 9 处** — 已全部补齐 `light:divide-slate-200` 显式规则。 `[UI]`

### P3 — 性能 / 包体积

- [x] **API 响应缓存继续推广** — 新增 `/api/preferences`、`/api/api-tokens`、`/api/images/stats` 三个端点。 `[性能]`
- [x] **更多低变动页面改 ISR** — 已改 6 页：`/snippets`(60s)、`/announcements`(60s)、`/api-tokens`(60s)、`/shares`(60s)、`/users`(60s)、`/operation-tasks`(30s)、`/status`(60s)、`/image-bed`(60s)。 `[性能]`

### P3 — 安全 / 依赖

- [ ] **跨大版本依赖（需验证）** — `typescript` 5.9 → 6.0（breaking, 升前跑全量 tsc）、`eslint` 9 → 10（配置格式变化）、`@types/node` 20 → 26（API 类型变化）、`undici` 7 → 8（Next.js 锁定，不要单独升）。 `[依赖]`
- [ ] **5 项 moderate npm 安全漏洞** — postcss XSS（GHSA-qx2v-qp2m-jg93）在 Next.js 内置依赖链，待官方升级。 `[安全/依赖]`
- [x] **同大版本依赖小升** — 所有包已为最新版本：@tailwindcss/postcss@4.3.2、@types/react@19.2.17、@vitejs/plugin-react@6.0.3、cron-parser@5.6.1、otplib@13.4.1、tsx@4.22.4、vitest@4.1.9。 `[依赖]`

---

### 🧱 长期路线图（参考方向，非具体待办）

- **测试覆盖率提升** — 当前 lines 74.88% / branches 59.93%，CI 阈值 lines/statements/functions 70%、branches 55%；可随测试补齐逐步收紧。
- **组件文档持续维护** — `src/components/README.md` 已建立；新增共享组件时同步追加说明。
- **AI 客户端工具扩展** — 已有 13 项 hosted tools（`list_servers` / `get_server_status` / `read_server_logs` / `list_docker_containers` / `check_service_status` / `execute_command` / `restart_service` / `modify_config` / `deploy_docker` / `list_backups` / `run_playbook` / `query_traffic` / `manage_cron`），可继续扩展覆盖更多运维场景。

---

### ⚠️ 审计订正（防止重复误报）

> 以下结论由前几轮审计反复确认，避免后续重复列入"待做"。

- **`csrf_token` cookie 不能加 `HttpOnly`** — 走 Double-Submit Cookie 模式，client 必须 `document.cookie` 读 token；加 `HttpOnly` 会直接破坏 CSRF 防护。承载身份的 session cookie 已 `httpOnly: true`，组合已满足 OWASP 推荐。`src/lib/auth/csrf-client.ts` 顶部已加 JSDoc。
- **`effect` / `@electric-sql/pglite*` 不能 `npm remove`** — 两者均为 `prisma@7.8.0` 的 transitive dependency，不在 `package.json` 顶层；验证 `npm ls effect` / `npm ls @electric-sql/pglite`。瘦身需 prisma 主动减少，非项目侧可解。
- **"4 个核心页面缺 PageHeader" 假阳性** — `/ai` 是聊天 UI、`/storage` 只 redirect、`/media` 与 `/image-bed` 已具备 eyebrow/title/description（自定义 hero header），无需补齐。

## 📄 许可
