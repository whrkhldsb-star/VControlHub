<div align="center">

# 🖥️ VPS 统一管控平台

**一站式 VPS 管理 · SSH 终端 · 分布式云盘 · 应用商店 · 智能运维**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)
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
- **媒体库** — 聚合图片/视频/音频，支持标签、收藏、类型切换筛选和一键回到源文件/图床外链
- **Aria2 下载** — 内置下载中心，远程任务管理
- **图床** — 图片上传 + 外链管理

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

| 模块 | 路径 | 说明 |
|------|------|------|
| 仪表盘 | `/` | 系统概览 + 统计卡片 + 趋势图 |
| VPS 管理 | `/servers` | 节点纳管、SSH 密钥、命令分发 |
| SSH 终端 | 弹窗 | 浏览器内 WebSocket 实时终端 |
| 文件管理 | `/files` | 多节点文件浏览/上传/下载/解压，支持可搜索节点下拉切换 |
| 云盘存储 | `/storage` | 本地/SFTP 存储节点管理与同步 |
| 应用商店 | `/quick-services` | 精选商店 / 社区推荐 / 已安装 / 应用源 |
| Docker | `/docker` | 容器管理（通过应用商店安装） |
| 监控 | `/monitoring` | 系统资源实时图表 |
| 告警规则 | `/alert-rules` | 自定义监控告警 |
| 通知 | `/notifications` | 站内消息中心 |
| AI 助手 | `/ai` | 多模型 AI 对话 + 工具调用，高风险操作需确认 |
| 命令模板 | `/templates` | 可复用 SSH/部署模板，提交后进入部署/审批记录 |
| 定时任务 | `/scheduled-tasks` | Cron 调度 + 执行日志 |
| 备份 | `/backups` | 数据库备份/恢复 |
| 部署 | `/deployments` | 应用部署运行记录、版本导出与最近部署重发（不是快照级真实回滚） |
| 下载中心 | `/downloads` | Aria2 任务管理 |
| 图床 | `/image-bed` | 图片上传 + 外链 |
| 媒体 | `/media` | 在线媒体浏览 |
| 工单 | `/tickets` | 内部工单系统 |
| 公告 | `/announcements` | 站内公告管理 |
| 分享 | `/shares` | 文件分享链接 |
| 代码片段 | `/snippets` | 代码片段收藏 |
| 用户管理 | `/users` | 用户 / 角色 / 权限管理 |
| 审计日志 | `/audit` | 操作审计追溯 |
| API 文档 | `/api-docs` | API 端点参考 |
| API Token | `/api-tokens` | 集成用 Token 管理 |
| 系统设置 | `/settings` | 全局配置 |
| 个人偏好 | `/preferences` | 用户偏好设置 |
| 健康检查 | `/health` | 服务健康状态 |

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

> 首次运行会自动生成 `.env.local` 模板并暂停，填写数据库密码、密钥等后重新运行即可。

### 自定义品牌部署

```bash
sudo APP_NAME="MyCloud" APP_SLUG=mycloud SITE_NAME="My Cloud Platform" \
  DOMAIN=cloud.example.com APP_DIR=/opt/mycloud \
  /opt/mycloud/deploy/install.sh
```

### 更多部署方式

| 方式 | 适用场景 | 说明 |
|------|----------|------|
| Git 仓库拉取 | 有 GitHub/GitLab 仓库 | `install.sh` 直接从仓库部署 |
| 压缩包离线 | 无公网/内网交付 | `package.sh` 打包 → 传到新机 → `install.sh` |
| rsync 同步 | 不入公网仓库 | 从旧服务器 rsync 源码 → `install.sh` |
| Caddy 自动 HTTPS | 有域名 | 默认启用；无域名自动切换 Apache |

详见 [deploy/README.md](deploy/README.md)

---

## ⚙️ 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.2.6 |
| UI | React + Tailwind CSS | 19 / 4 |
| 数据库 | PostgreSQL + Prisma | 15 / 7.7 |
| 认证 | lucia-auth + bcrypt | — |
| SSH | ssh2 + WebSocket | 1.17 |
| 下载 | Aria2 JSON-RPC | — |
| 反向代理 | Caddy (自动HTTPS) / Apache | — |
| 进程管理 | systemd | — |
| 容器 | Docker (应用商店) | — |
| 代码量 | **~79,700 行** TypeScript/TSX（`src` 扫描） | — |

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

| 文件 | 用途 |
|------|------|
| `deploy/bootstrap.sh` | fresh server 一行安装入口，负责拉取仓库并调用安装脚本 |
| `deploy/install.sh` | 一键安装/重装/升级核心脚本，生成环境变量、构建、写 systemd 和反代 |
| `deploy/upgrade.sh` | 升级入口，默认升级前备份并在完成后自检 |
| `deploy/check.sh` | 不泄密的部署健康检查，可选 `RUN_NPM_CHECKS=1` 执行完整 npm 门禁 |
| `deploy/smoke-test.sh` | 线上冒烟测试，覆盖 systemd、端口、Caddy、登录页、静态资源和 SSH-WS |
| `deploy/package.sh` | 生成不含运行数据/密钥的发布压缩包 |

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

| 指标 | 数量 |
|------|------|
| 功能页面 | 39 |
| API 端点 | 75 |
| 数据模型 | 43 |
| UI 组件 | 27 |
| 代码行数 | ~79,700（src 扫描） |
| Docker 应用模板 | 44 (本地) + 187 (社区) |

---

## 🔎 当前可用性与功能完整性状态（2026-06-07）

> 当前重点已经从“页面是否能打开”推进到“按钮是否真的有副作用、设置项是否真的生效、后台任务是否真的会跑、安装脚本是否能支撑 fresh install”。以下状态来自生产修复、单元测试、构建和 smoke-test 的收尾结果。

### 已完成的关键闭环

- [x] **前后端枚举一致性修复** — 公告类型创建/编辑表单发送 `critical` 但 API 只接受 `urgent`，导致"严重/紧急"级别公告完全无法创建；已统一为 `urgent`。快捷服务应用源预设 URL 从 `example.com` 占位符改为空值，避免误导用户同步失败。
- [x] **片段所有权校验** — 代码片段的编辑和删除操作现在校验操作者身份：只有创建者或拥有 `role:manage` 权限的管理员可以修改/删除，修复了任意用户可改删他人片段的 IDOR 问题。
- [x] **强制改密拦截** — `requireSession` 中增加 `mustChangePassword` 检测，管理员强制重置密码后用户首次登录会自动跳转改密页。
- [x] **权限门控完善** — 用户管理页面的创建/权限配置/禁用按钮现在受 `user:manage` 权限控制；命令模板列表 GET 权限从 `command:create` 修正为 `command:read`。
- [x] **分享链路可用** — `/shares` 生成的 `/share/[token]` 已有公开落地页；页面只读预览不增加下载计数，下载仍走 `/api/share/[token]` 计数端点。
- [x] **设置项真实生效** — `session.timeout` 会影响普通登录 session TTL；密码复杂度设置会约束改密、创建用户和重置密码。
- [x] **后台功能不再只停留在 UI** — 定时任务 worker 随服务启动，按到期时间触发命令请求并记录运行结果；告警评估 worker 随服务启动并周期检查规则。
- [x] **下载中心批量语义补齐** — HTTP/HTTPS 批量下载会为每个 URL 创建独立任务；磁力/BT 与普通 URL 混合批量会在前端提前拦截并明确提示需单独创建，避免按页面示例操作却被后端拒绝；新建下载只展示已启用、已绑定存储且配置了 SSH 凭据的可用 VPS；选择目标 VPS 时会即时显示该节点当前真实访问模式（直连/中转）；已完成任务的“下载文件”入口复用文件管理同一套 `buildDirectAccessStrategy`，Direct Gateway 可用时显示并走直连，未配置或切回网站中转时显示并走 SFTP 中转。
- [x] **文件管理当前节点操作闭环** — 多节点文件页的新建文件夹和上传会默认落到当前正在浏览/筛选的 LOCAL/SFTP 节点，创建成功后自动刷新 SPA 文件列表，避免操作成功但列表仍停留旧状态或误传到第一个节点。
- [x] **代码片段与权限死控件收口** — `/snippets` 创建/编辑现在在 API 和 service 层统一校验并保存标题、内容、描述、标签和私有状态，空白标题/内容会被拒绝；片段复制失败会给出可见提示，移动端/键盘聚焦也能看到复制/编辑/删除入口。命令模板下发、下载任务刷新、告警立即检测等写操作按钮已按真实后端权限隐藏，避免只读用户看到点击后 403 的死控件；告警创建表单补齐持续时间和目标节点字段，图床上传到存储节点副本前会复用文件管理写入权限校验。
- [x] **工单更新更完整** — 状态、负责人、优先级可以一起更新，避免 UI 有字段但 API 丢弃。
- [x] **一键安装脚本已增强** — 无域名安装进入 Apache/IP 直连路径；`APP_SLUG` 可带短横线，默认 PostgreSQL 用户/库名会安全转换为下划线标识符；部署资产校验进入 `npm run verify`。
- [x] **smoke-test 部署假设已拆分** — `deploy/smoke-test.sh` 支持 `SMOKE_SCOPE=systemd`（本机 systemd/端口检查）和 `SMOKE_SCOPE=http`（公网黑盒 HTTP 检查），Makefile 提供 `make smoke-systemd` / `make smoke-http`，适配外部数据库、非本机数据库和自定义反代场景。
- [x] **系统设置页闭环** — `/settings` 已补齐平台、会话/密码、运行参数、SMTP 的保存后生效范围说明；前端会即时拦截越界数字/非法 URL/邮箱格式，后端 PATCH 会统一归一化并拒绝无效配置，避免“保存成功但值不可用”。
- [x] **定时任务增强闭环** — `/scheduled-tasks` 已补齐 Cron 预设/即时预览、下一次运行时间展示、最近执行日志展示与搜索、失败/历史任务手动重试入口；重试会重新创建命令请求并写回执行记录，便于从任务页完成诊断与再执行。
- [x] **告警测试发送闭环** — `/alert-rules` 每条规则可直接触发测试发送，站内通知会发送给具备 `notification:manage` 权限的管理员，Webhook 会发送安全测试请求；页面展示每个渠道的发送/跳过/失败结果，API 审计不记录 Webhook 密钥。
- [x] **备份策略可视化闭环** — `/backups` 已新增备份策略概览：完成/失败/执行中数量、已用备份空间、最大备份、超过 30 天保留提示，以及 DATABASE/FILES/FULL 分类型容量汇总；备份记录大小展示改为 B/KB/MB/GB 自适应，避免小备份被四舍五入成 `0 MB`。
- [x] **快捷服务一键更新闭环** — `/quick-services` 已为已安装服务提供“更新”动作，后端会 `docker pull` 当前镜像、重建 `qs-*` 容器并复用既有端口/挂载/环境/命令配置；更新中写入 `installing` 状态，成功回到 `running`，失败写入可见错误；更新完成后 API 返回 Docker health/status 与最近日志尾部，前端会把健康状态和最近日志摘要直接展示在成功提示里。
- [x] **在线文本文件编辑闭环** — `/files/preview` 对本机 LOCAL 存储中的可编辑文本文件展示“编辑”入口，加载 `/api/files/editable/[id]` 草稿后可在浏览器内修改并保存；后端复用存储权限、限定文本类型与 512 KB 大小，保存后更新文件大小/时间戳并清空旧 checksum，避免误编辑远端或二进制文件。
- [x] **浅色模式代码/命令块统一** — 代码片段、应用部署、快捷服务安装提示、备份/定时备份等同类代码/命令预览块统一为浅色中性 code surface，避免浅色模式下同样语义的命令块一会儿白底、一会儿黄底或被 inline code 全局样式覆盖；快捷服务卡片/应用源/弹窗补齐浅色边框和文本状态。
- [x] **媒体库 / 图床融合闭环** — `/media?type=image` 现在作为图片工作区，支持加载本地或 SFTP 存储节点、批量上传图片到指定存储目录并生成图床外链；已有存储图片可从媒体卡片直接发布为图床外链，图片列表搜索也从单一“相册”扩展为文件名/路径/相册关键词，避免媒体库和图床两个页面功能割裂。
- [x] **图片外链管理入口收口** — `/image-bed` 保留为兼容的外链管理/发布来源审计页，但不再作为主导航里的并列“图床”模块；图片新建、批量上传、类型筛选和发布入口统一从 `/media?type=image` 图片工作区进入，外链审计只在图片工作区内作为辅助入口展示。
- [x] **图床删除授权收紧** — `/api/images/[id]` 和 `/api/images/batch` 不再把默认 viewer 也拥有的 `user:read` 当作跨用户删除许可；单图删除仅允许图片所有者、`storage:delete` 或 `role:manage`，批量删除仅允许显式管理/删除权限，并补充 IDOR 回归测试。
- [x] **媒体库图片/视频/音频切换补齐** — `/media` 增加一等类型切换区，图片、视频、音频和全部媒体入口会保留搜索/标签/收藏条件，已选类型可再次点击取消；类型计数改为跨当前筛选条件的全局统计，不再只统计当前列表结果，图片模式继续显示批量上传和发布外链工作流。
- [x] **全局搜索入口死路径清理** — 全局搜索目录由主侧边栏与系统导航统一生成，测试覆盖所有侧边栏页面入口，并明确排除 `/system-health`、`/quickservice`、`/backup`、`/ssh` 等旧路径；改密与两步验证入口已改为 `/settings#password` 和 `/settings#2fa`，不再派发不存在的弹窗事件。

### 目前仍存在的问题 / 使用边界

- [x] **在线文本文件编辑权限边界收紧** — `/api/files/editable/[id]` 读取和保存现在都会把当前 session 传入存储服务，并在解析 LOCAL 文件条目后调用 `assertStorageAccess` 校验对应存储节点与相对路径；读取需要具体 `read` 授权，保存会按新内容字节数校验 `write` 授权/配额，避免只有全局 `storage:read/write` 的用户通过文件条目 ID 绕过细粒度路径授权。
- [x] **远端文件代理范围收紧** — `/api/servers/[id]/file-proxy` 启动临时 Python 代理前必须确认服务器绑定了 SFTP 存储节点，生成脚本时把 `SERVE_DIR` 限制到该节点 `basePath`，并在目标主机内做 realpath 边界校验；代理现在优先使用 `Authorization: Bearer` 或 `X-VControlHub-Proxy-Token` header 校验 token，只保留 query token 作为旧客户端兼容兜底，同时把 CORS 从 `*` 收紧到发起请求的 Hub origin 并补充 `Referrer-Policy: no-referrer` / `nosniff`。
- [ ] **后台任务缺统一 durable job/lease/并发控制（P1）。** 任务中心目前主要是聚合命令、定时任务、下载、同步、备份、部署等业务表状态，不是统一任务队列。命令请求已补 `workerId` / `workerHeartbeatAt` 与陈旧 RUNNING 恢复，但实际执行、下载 direct/relay、QuickService 安装仍由 API 进程内 fire-and-forget 或请求内长操作驱动；定时任务和告警评估仍是每个 Node 进程内存轮询。多实例、重启或长任务场景下仍可能重复触发、丢失进度、取消不可靠或只能事后修正状态。后续需要 DB-backed job queue/lease/heartbeat/retry/cancel/progress，并增加全局/按用户/按节点并发上限。
- [ ] **备份/恢复、SFTP 同步仍是请求内长任务（P1）。** 备份/恢复 API 会在 HTTP 请求内同步等待最长 30 分钟的 `deploy/backup.sh`、`restore-db.sh` 或 `tar`；SFTP 同步 API 在请求内递归扫描远端目录并逐条写库，只有单目录 timeout，没有整任务 checkpoint、进度、取消和恢复。大目录、大备份或反向代理超时时容易造成请求占用、状态不清晰。后续应全部改为可观测后台任务，补进度、心跳、取消、失败重试、保留策略清理和恢复演练记录。
- [x] **邮件告警通道已接入 SMTP** — SMTP 设置页新增告警收件人配置，保存时校验并规范化邮箱列表；告警测试发送现在会真实调用 SMTP 邮件通道并返回发送/拒收结果，真实告警评估也会在 `email` 渠道选中时 best-effort 发送邮件，不再是“可选但不可发送”的死路径。后续仍可继续补失败重试和发送历史。
- [x] **快捷服务卸载闭环补齐** — 已安装快捷服务现在不仅有卸载确认弹窗，还可以选择是否同时删除该服务模板记录的宿主机数据目录；默认仅删除容器和数据库记录并保留 `/opt/`、`/srv/` 下数据，勾选后才会清理允许范围内的挂载目录，且不会删除 Docker socket、时区文件或根目录，避免“一键卸载”只停在容器层或误删共享宿主资源。
- [ ] **部署“回滚”目前只是重发最近部署（P1）。** `/deployments` 的“快速回退/按此记录重发”会用同一模板、变量和服务器重新提交部署，并不是快照级回滚、上个版本恢复或失败自动回退；README 已改为“最近部署重发”，后续需要补真实回滚语义。
- [ ] **AI Hosted Tools 授权边界仍需收紧（P1）。** `/api/ai/chat` 只要求 `ai:chat`，启用 Hosting 后模型可携带 `serverId` 触发托管工具；`get_server_status`、`read_server_logs`、`check_service_status` 等低风险工具会自动批准并通过 SSH 执行，目前未按 `server:ssh`、服务器所有权或细粒度节点授权再校验。`read_server_logs` 虽做 shell quoting 和路径字符限制，但未限制在 `/var/log` 等安全目录；危险工具会进入审批流，但默认“原请求者可批准自己的操作”，不等同管理员审批。后续需要增加服务器级授权校验、只读工具目录白名单、审批人分离/管理员审批策略。
- [ ] **Docker / QuickService / Direct Gateway 仍有部署边界需要说明和加固（P1）。** Docker 模块只管理 Hub 所在机器的 `/var/run/docker.sock`，不是跨 VPS 容器控制台；安装脚本会把应用运行用户加入 `docker` 组，拥有 `docker:manage` 的 Web 用户可间接操作本机 Docker，安全边界接近宿主机 root。QuickService 对远端应用源已限制宿主机挂载路径并默认禁止 Docker socket，但第三方模板仍属于供应链输入，且安装/更新还缺配置 diff、失败回滚和历史日志。Direct Gateway 默认生成 `http://host:31888` 明文直连链接并监听 `0.0.0.0`，签名能鉴权但不提供传输加密，需要反代 TLS/VPN/防火墙或改造默认部署。
- [ ] **公开状态与运行态展示仍可能过于乐观（P2）。** `/status` 已把启用 VPS/存储节点文案从“服务在线”改为“已启用/已配置，未做实时 SSH/SFTP/直连探测”，不再把资产配置伪装成实时可达；但公开状态页、VPS 列表徽章和存储/直连入口仍未接入真实 SSH、Direct Gateway、SFTP 存储可达性探测，后续应补真实健康探测或继续在列表层明确展示“未实时探测”。
- [ ] **前端可访问性、移动端和浏览器导航仍需系统化收口（P2）。** 全局搜索已具备 `dialog` 语义、初始聚焦和 Escape 关闭，但仍缺 focus trap/focus restore；SSH 终端缺 Escape/focus trap/focus restore，且固定 `minHeight: 400px`、横向命令侧栏在手机上仍易拥挤；Docker 日志弹窗缺 `role="dialog"` / `aria-modal` / 标题关联、Escape 和焦点管理；文本预览搜索/跳转、文件浏览搜索、SSH 常用命令输入等仍依赖 placeholder 而缺显式 label；文件浏览使用 `replaceState` 更新目录 URL，浏览器后退不能逐级回到上一个目录。
- [ ] **AI Provider 与应用源 URL 仍存在 SSRF/出网信任边界（P1/P2）。** AI Provider 的 `baseUrl`、模型探测 `/models`、聊天 `/chat/completions` / `/messages` 以及 QuickService 自定义应用源 URL 都是管理用户配置后由服务端发起 fetch；当前主要校验 URL 格式，尚未统一拦截 localhost、内网、链路本地、metadata 地址、DNS rebinding 或重定向到私网。生产部署应通过网络层 egress policy、代理 allowlist 或代码层 URL/IP 解析校验收紧，并在文档中明确只有受信任管理员可配置这些 URL。
- [ ] **文件预览/分享仍有部分入口未完全闭环（P1/P2）。** SFTP 音视频预览目前仍复用 `/api/storage/sftp-download` 普通下载流，缺少 `Range` / `206` 支持，和媒体库 `/api/media/[id]/stream` 已有受控流能力不一致，大文件拖动播放体验可能不稳定；公开目录分享可以浏览并下载目录内具体文件，但尚不能像登录态 `/api/storage/archive-download` 那样一键打包下载整个目录；Office 预览和压缩包在线解压是安全降级入口，主要提供说明/下载，后续应在列表按钮和 README/API 文档里更早提示当前边界，或补专用 storage media stream、share archive endpoint 和受控格式解压。
- [ ] **存储节点元数据和文件状态一致性仍需治理（P2）。** 文件读写、SFTP 下载、Direct URL 生成已调用 `assertStorageAccess` 并限制在节点 `basePath` 内；但 `/api/storage/nodes` 对具备 `storage:read` 的用户返回所有存储节点的 `basePath` 和部分服务器信息，尚未按 `UserStorageAccess` grant 过滤，可能暴露目录结构和节点存在性。文件删除仍是先删物理对象再标记数据库，失败时可能出现 DB 与磁盘不一致，恢复也可能只恢复 DB 标记；存储概览和文件列表仍有未分页 `findMany` 与内存聚合，大文件索引实例会有性能风险。
- [ ] **既有增强项仍在队列中。** 备份策略还缺异地备份、自动恢复演练和保留策略自动清理；本机文本编辑还缺并发修改提示、保存后可选重载服务和 SFTP 编辑；媒体库/图床还可补图片目录批量选择和更完整的相册/标签管理；告警通道还可补 Telegram、失败重试和发送历史趋势。

---

## 🗺️ 下一步升级方向

### P0 — 收尾质量门禁 / 安装可信度
- [x] 一键安装 fresh install 关键路径：环境变量生成、反向代理分支、PostgreSQL 标识符、runtime bundle、systemd 模板。
- [x] 核心质量门禁：typecheck、lint、测试、Next build、runtime build、部署资产校验。
- [x] 将 smoke-test 拆分为 `SMOKE_SCOPE=systemd` / `SMOKE_SCOPE=http`，减少对本机服务名、PostgreSQL 本机实例和固定反代类型的硬编码。
- [x] 增加 `make installer-fakeroot` / `deploy/fakeroot-install-check.sh` 回归入口，覆盖域名/Caddy、无域名/Apache、`SKIP_PACKAGES=1`、`DESTDIR` 四类 installer 分支。

### P1 — 功能设置真实可用
- [x] 会话超时、密码策略、定时任务、告警规则、批量下载、工单优先级、snippet 元数据等“有 UI 但无真实效果/效果不完整”的问题已补齐。
- [x] 告警增强：静默期、Webhook 测试发送和 email/SMTP 真实发送已完成；后续继续补 Telegram 等通知渠道配置、失败重试和告警历史趋势。

### P2 — 用户体验和可运营性
- [ ] 快捷服务生命周期：安装、启动/停止、状态刷新、更新和卸载（含可选数据目录清理）已闭环，继续补配置 diff、失败回滚、更新历史，并纳入统一 durable job/lease，避免安装/更新/卸载继续依赖请求内长任务或进程内锁。
- [ ] 在线文件编辑器：本机文本编辑/保存/权限边界、差异预览和保存确认已完成，继续补并发修改检测、保存后可选重载服务和 SFTP 编辑。
- [x] 媒体库 / 图床融合：图片模式已合并批量上传、目标存储目录、已有存储图片发布外链和图片搜索；媒体库已补一等图片/视频/音频切换，主导航不再暴露独立图床模块，外链管理作为图片工作区辅助入口。
- [ ] 备份策略管理：UI 化定时备份入口已完成，继续补后台任务化执行、异地备份、恢复验证、保留策略自动清理。
- [ ] 操作回滚：关键文件/配置/部署操作提供 undo 或恢复点。
- [ ] 仪表盘自定义：拖拽卡片、指标选择、时间范围筛选。
- [ ] 状态真实性：公开状态页已区分“已配置/已启用”和“未实时探测”；继续让 VPS 列表徽章、存储/直连入口接入 SSH/SFTP/Direct Gateway 探测，或在列表层明确展示“未实时探测”。
- [ ] 可访问性收口：为 SSH 终端、Docker 日志、全局搜索等弹窗统一补 focus trap、Escape、focus restore；为文本预览搜索/跳转、文件浏览搜索、SSH 命令输入等补显式 label/aria-label。
- [ ] 移动端适配：底部导航已覆盖核心入口，后续补更多高频入口/溢出菜单；SSH 终端、Docker 日志、文件浏览等复杂面板需改为手机友好的纵向布局、触摸友好控件和危险操作二次确认。

### P3 — 长期愿景
- [ ] 自动化工作流（Playbook）：条件触发、告警联动、步骤编排。
- [ ] 多租户/团队空间：资源隔离、配额管理、权限继承。
- [ ] 成本追踪：VPS 费用、带宽/存储用量、月度报告。
- [ ] 智能运维 AI：主动诊断建议、异常预测、自动修复建议。
- [ ] PWA 离线支持和集成市场。

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
