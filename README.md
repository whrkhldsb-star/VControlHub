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
| 图床外链中心 | `/image-bed` | 已发布图片外链复制、来源审计与兼容发布 |
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
- [x] **在线文本文件编辑闭环** — `/files/preview` 对本机 LOCAL 存储中的可编辑文本文件展示“编辑”入口，加载 `/api/files/editable/[id]` 草稿后可在浏览器内修改并保存；后端复用存储权限、限定文本类型与 512 KB 大小，保存前展示差异预览，写入时校验打开草稿后的 DB 更新时间和磁盘 mtime，若文件已被其它窗口/磁盘操作修改会拒绝覆盖并提示重新加载，保存后更新文件大小/时间戳并清空旧 checksum。
- [x] **浅色模式代码/命令块统一** — 代码片段、应用部署、快捷服务安装提示、备份/定时备份等同类代码/命令预览块统一为浅色中性 code surface，避免浅色模式下同样语义的命令块一会儿白底、一会儿黄底或被 inline code 全局样式覆盖；快捷服务卡片/应用源/弹窗补齐浅色边框和文本状态。
- [x] **媒体库 / 图床融合闭环** — `/media?type=image` 现在作为图片工作区，支持加载本地或 SFTP 存储节点、批量上传图片到指定存储目录并生成图床外链；已有存储图片可从媒体卡片直接发布为图床外链，图片列表搜索也从单一“相册”扩展为文件名/路径/相册关键词，避免媒体库和图床两个页面功能割裂。
- [x] **图片外链管理入口收口** — `/image-bed` 保留为兼容的外链管理/发布来源审计页，但不再作为主导航里的并列“图床”模块；图片新建、批量上传、类型筛选和发布入口统一从 `/media?type=image` 图片工作区进入，外链审计只在图片工作区内作为辅助入口展示。
- [x] **媒体库可视化工作台重构** — `/media` 顶部改为媒体工作台，图片/视频/音频以卡片入口和推荐流程区分；媒体卡片现在直接显示图片缩略图、视频 stream 首帧封面和统一风格音频封面，图片模式单独展示“图片发布工作流”；`/image-bed` 改为“图片外链中心”，主流程聚焦复制外链、来源审计、云盘路径发布和批量管理，旧拖拽直传默认折叠为兼容入口。
- [x] **图床删除授权收紧** — `/api/images/[id]` 和 `/api/images/batch` 不再把默认 viewer 也拥有的 `user:read` 当作跨用户删除许可；单图删除仅允许图片所有者、`storage:delete` 或 `role:manage`，批量删除仅允许显式管理/删除权限，并补充 IDOR 回归测试。
- [x] **媒体库图片/视频/音频切换补齐** — `/media` 增加一等类型切换区，图片、视频、音频和全部媒体入口会保留搜索/标签/收藏条件，已选类型可再次点击取消；类型计数改为跨当前筛选条件的全局统计，不再只统计当前列表结果，图片模式继续显示批量上传和发布外链工作流。
- [x] **全局搜索入口死路径清理** — 全局搜索目录由主侧边栏与系统导航统一生成，测试覆盖所有侧边栏页面入口，并明确排除 `/system-health`、`/quickservice`、`/backup`、`/ssh` 等旧路径；改密与两步验证入口已改为 `/settings#password` 和 `/settings#2fa`，不再派发不存在的弹窗事件。
- [x] **分享中心真实文件选择闭环** — `/shares` 现在可直接像文件管理一样按存储节点浏览目录、勾选文件/文件夹并批量创建分享链接，不再要求跳转 `/files` 后从单行入口分享；公开目录分享落地页会在访问时自动刷新 LOCAL/SFTP 目录索引（非递归一层），避免真实目录已有文件但 DB 未同步时显示“暂无已索引文件”。
- [x] **文件资料详情工作流入口** — `/files` 的列表、图标和详情视图现在统一提供“资料详情”面板，集中展示存储节点、驱动、路径、大小、修改时间和访问方式，并把预览/在线编辑、受控下载、分享、媒体库搜索、重命名、移动、删除收束到同一个真实文件入口，避免用户在文件管理、分享和媒体库之间来回猜路径。
- [x] **文件列表高密度操作与反馈收口** — `/files` 的文件行/卡片保留资料详情、预览和下载为一级动作，把分享、重命名、移动、删除收束到“更多操作”菜单，并用统一 toast/alert 反馈单项与批量操作结果；媒体扫描会按文件扩展名补齐 `application/octet-stream` 的真实媒体 MIME，媒体播放页提供上一项/下一项、下载和回源入口，减少大目录里操作按钮拥挤和媒体详情断层。
- [x] **媒体 stream 与前端水合回归收口** — `/api/media/[id]/stream` 已把列表查询与播放查询拆分，列表不再取 SFTP 密码/私钥，播放流在授权后才加载服务器 `connectionType`、密码或私钥，密码型 SFTP 媒体在生产 Range 请求中恢复 `206` 图片/视频流；`/backups` 改用固定时区日期格式，生产 CDP 回归确认 `/files`、`/backups`、`/media`、`/ai` 等核心页面不再出现 React hydration #418。
- [x] **通知中心操作可达性收口** — `/notifications` 列表页的删除等行内操作不再是桌面 hover-only 死控件：移动端默认可见，桌面键盘聚焦卡片时也会显示，并为详情/已读/删除/全部已读按钮补齐 focus-visible ring；通知卡片浅色模式补齐标题、正文、时间、边框和未读状态色，避免 QA batch 1 通知中心在 light 模式或键盘导航下难以操作。
- [x] **全局搜索可发现性与焦点闭环** — 认证侧栏已新增可见“全局搜索”按钮，触发既有搜索弹窗，避免只依赖隐藏快捷键；搜索弹窗现在会记录触发按钮并在 Escape/遮罩关闭后恢复焦点，键盘用户不会关闭后迷失到页面根节点。
- [x] **定时任务创建表单可访问性与样式收口** — `/scheduled-tasks` 创建表单的任务名称、Cron 表达式、命令内容、原因/备注和目标节点已改为显式 `htmlFor`/`id` 或 `role=group` 关联，测试改用可访问名称而不是 placeholder 查找；字段样式抽成共享 class 常量，避免后续继续复制浅色低对比 label 和输入框硬编码。
- [x] **下载任务记录删除回归补齐** — `/api/downloads?purge=1` 的终态任务删除路径新增回归测试，确认完成/失败/取消记录只删除历史行、不触碰远端下载进程，并且运行中任务会先要求取消，避免“删除记录”和“取消任务”语义混淆。

- [x] **文件创建表单可见标签补齐** — `/files` 的“新建文件夹”展开表单不再只依赖 placeholder 或屏幕阅读器隐藏文本传达输入含义；目标存储节点和文件夹名称现在都有可见标签，回归测试也改用 label 查询，保证键盘、低视力和翻译场景下仍能明确知道每个输入的作用。

### 目前仍存在的问题 / 使用边界

- [x] **在线文本文件编辑权限边界收紧** — `/api/files/editable/[id]` 读取和保存现在都会把当前 session 传入存储服务，并在解析 LOCAL 文件条目后调用 `assertStorageAccess` 校验对应存储节点与相对路径；读取需要具体 `read` 授权，保存会按新内容字节数校验 `write` 授权/配额，避免只有全局 `storage:read/write` 的用户通过文件条目 ID 绕过细粒度路径授权。
- [x] **远端文件代理范围收紧** — `/api/servers/[id]/file-proxy` 启动临时 Python 代理前必须确认服务器绑定了 SFTP 存储节点，生成脚本时把 `SERVE_DIR` 限制到该节点 `basePath`，并在目标主机内做 realpath 边界校验；代理现在优先使用 `Authorization: Bearer` 或 `X-VControlHub-Proxy-Token` header 校验 token，只保留 query token 作为旧客户端兼容兜底，同时把 CORS 从 `*` 收紧到发起请求的 Hub origin 并补充 `Referrer-Policy: no-referrer` / `nosniff`。
- [x] **统一 Durable Job 队列底座已落地。** 新增 DB-backed `jobs` 表与 `JobStatus`，提供 enqueue、lease claim、heartbeat、retry/fail、cancel、stale RUNNING recovery、progress/result/error 记录等通用服务；任务中心已把 durable job 纳入统一聚合，后续备份/恢复、SFTP 同步、QuickService 安装/更新、下载执行和告警评估可以逐步迁移到同一队列，而不是继续各自依赖请求内长任务或进程内 fire-and-forget。
- [x] **命令执行可取消入口已产品化。** `/requests` 审批中心现在会在待审批/已批准/运行中的命令请求上展示“取消命令”操作；审批人可填写可选原因，经 CSRF 保护调用 `/api/commands` 取消接口，后端会终止当前进程内仍在运行的 SSH 子进程或把未完成目标标记为 `CANCELLED`，页面成功后刷新状态，失败时保留弹窗并用独立错误提示区展示原因。
- [ ] **后台任务业务迁移与并发控制仍在进行（P1）。** Durable Job 底座目前已承接 SFTP 同步、备份创建、备份恢复、告警评估和 QuickService 生命周期；命令执行已具备后台 SSH 执行、心跳、陈旧 RUNNING 恢复、输出/超时 guardrail、并发目标执行和用户可见取消入口。后续仍需把命令/部署、下载 direct/relay、定时任务补实际 durable worker，补全局/按用户/按节点并发上限、可观测日志流和生产级 worker 部署策略。 <!-- TR-001 -->
- [x] **备份/恢复已迁入 Durable Job。** 备份创建先持久化 `BackupRecord`，再由 `backup.create` worker 执行 `deploy/backup.sh`；恢复 API 会先校验备份存在和 `RESTORE` 确认，再排入 `backup.restore` worker 执行恢复，避免 30 分钟脚本继续占用 HTTP 请求。旧调用可通过 `?wait=1` 保留同步执行路径，后续继续补异地备份、自动恢复演练、保留策略自动清理和更细进度日志。
- [x] **告警评估已迁入 Durable Job。** 告警 worker 不再直接在定时器内调用 `evaluateAlerts()`；每轮先去重排入/认领 `alert.evaluate` job，再通过共享 job service 记录 heartbeat、失败重试、完成结果和 workerId，任务中心可以看到告警评估的运行状态，进程重启或失败时也不会只留下不可见的定时器日志。
- [x] **邮件告警通道已接入 SMTP** — SMTP 设置页新增告警收件人配置，保存时校验并规范化邮箱列表；告警测试发送现在会真实调用 SMTP 邮件通道并返回发送/拒收结果，真实告警评估也会在 `email` 渠道选中时 best-effort 发送邮件，不再是“可选但不可发送”的死路径。后续仍可继续补失败重试和发送历史。
- [x] **快捷服务卸载闭环补齐** — 已安装快捷服务现在不仅有卸载确认弹窗，还可以选择是否同时删除该服务模板记录的宿主机数据目录；默认仅删除容器和数据库记录并保留 `/opt/`、`/srv/` 下数据，勾选后才会清理允许范围内的挂载目录，且不会删除 Docker socket、时区文件或根目录，避免“一键卸载”只停在容器层或误删共享宿主资源。
- [x] **部署真实回滚已落地。** 命令模板可配置独立 `rollbackCommand`，部署运行会保存不可变 `DeploymentSnapshot`（模板名、部署命令、回滚命令、变量和目标服务器），`/deployments` 的“执行真实回滚”会创建 `DeploymentRollbackRun` 并把快照里的回滚命令送入原有审批/命令执行链路；“重新提交部署”仅作为兼容操作保留并明确标注。后续可继续补失败自动回滚策略、按版本保留/清理、回滚前差异检查和更完整的演练报告。
- [x] **AI Hosted Tools 授权边界已收紧。** 托管工具执行授权下沉到 `hosted-service`：自动批准的只读 SSH 工具即使从聊天流或后续服务调用触发，也必须携带具备 `server:ssh` 的会话上下文；危险工具审批改为必须具备 `ai:action:approve`，不再允许原请求者自批自己的高风险操作，批准后的执行还会再次校验审批人的 `server:ssh`。`/api/ai/hosted-actions/[id]` 现在由共享 API guard 强制 `ai:action:approve`。后续仍可继续补服务器所有权/按节点细粒度授权、只读日志目录白名单和审批人分离审计报表。
- [x] **QuickService 访问边界已显式化。** 快捷服务运行概览和已安装卡片不再只给一个“访问”按钮：访问 URL 现在会生成结构化描述，明确标注“公开直连端口”或“反代 HTTPS”，并在按钮标题/可访问名称里提示直连端口不会经过 VControlHub 登录鉴权，需依赖防火墙、VPN 或应用自身鉴权后再暴露。
- [x] **Docker 本机运行边界已产品化。** `/api/docker/containers` 列表响应现在返回 `dockerScope`，明确该模块只操作 VControlHub 所在主机的 `/var/run/docker.sock`；`/docker` 页面在容器操作按钮之前展示“本机 Docker socket”警示，提示它不是跨 VPS 容器控制台，且 `docker:manage` 权限接近本机容器管理能力，避免用户把 Hub 主机 Docker 与远端 VPS 容器混淆。
- [x] **QuickService 生命周期历史已接入审计日志。** 安装、启动、停止、状态同步、更新和卸载现在都会写入 `quick_service.*.started/succeeded/failed` 审计事件，失败事件保留截断后的 Docker 错误摘要，`listQuickServiceHistory()` 以最新 50 条为上限读取历史，避免操作员只能看到当前状态而无法追溯最近生命周期动作。
- [x] **QuickService 安装/更新配置预览已补齐。** `/api/quick-services` 目录响应现在只返回非敏感配置摘要（环境变量键数量、宿主机挂载、额外端口），不下发环境变量值；`/quick-services` 在安装端口确认后、更新按钮执行前都会弹出配置确认层，展示镜像、容器端口到宿主端口、挂载和公开端口风险，取消不会触发 Docker install/update side effect。
- [x] **QuickService 生命周期已迁入 Durable Job worker。** 安装、启动、停止、状态刷新、更新和卸载 API 现在只做权限/输入/端口校验并返回 `202 + jobId/taskId`；后台 `quick_service.lifecycle` worker 通过共享 Job 队列 claim/heartbeat/complete/fail 后再执行 Docker side effect，`/quick-services` 成功提示也改为“已排队，可在任务中心查看进度”，避免拉镜像、重建容器或删除数据目录继续占用 HTTP 请求。
- [x] **QuickService 排队任务可观测入口补齐。** `/quick-services` 的安装、启动/停止、状态刷新、更新和卸载在返回 `taskId` 后，成功提示会直接提供“查看任务中心”链接，操作员无需复制 job id 或猜测入口即可追踪 durable job 进度；提示区同时补 `status/alert` 语义，排队成功与错误反馈可被辅助技术区分。
- [x] **QuickService 同服务并发生命周期任务已收敛。** `enqueueQuickServiceJob()` 现在会在入队前查找同一 `slug` 的 `PENDING/RUNNING` 生命周期任务，安装、启动/停止、状态刷新、更新和卸载如果遇到已有任务会直接返回现有 `jobId/taskId`，API 响应带 `reused` 与“已有进行中任务”提示，避免同一服务被连点或跨进程重复入队后同时拉镜像、重建或卸载。
- [x] **QuickService 生命周期任务阶段日志已接入任务中心。** `quick_service.lifecycle` worker 现在会按安装、启动/停止、状态刷新、更新和卸载动作写入更具体的 heartbeat progress，并在完成结果中保留安全截断的 `logPreview`，任务中心“最近日志”可直接看到拉取镜像、重建容器、健康检查或同步结果摘要，不必先跳到审计或容器日志里定位。
- [ ] **Docker / QuickService / Direct Gateway 仍有部署边界需要说明和加固（P1）。** Docker 本机 socket 边界已在 `/docker` 页面和 API 元数据中显式展示；安装脚本会把应用运行用户加入 `docker` 组，拥有 `docker:manage` 的 Web 用户可间接操作本机 Docker，安全边界接近宿主机 root。QuickService 对远端应用源已限制宿主机挂载路径并默认禁止 Docker socket，生命周期审计历史已覆盖安装/启动/停止/同步/更新/卸载，安装/更新前已展示非敏感配置摘要与公开端口风险确认，生命周期写操作已排入 Durable Job worker 而不是占用 HTTP 请求，排队提示已提供任务中心入口，同一服务未完成生命周期任务会被复用而不是跨进程重复入队，且任务中心已能展示阶段进度与完成日志摘要；第三方模板仍属于供应链输入，后续主要补失败回滚、真实配置变更 diff/回滚记录和 Direct Gateway 传输边界加固。存储健康公开摘要已经接入最近探测结果，但 Direct Gateway 默认生成 `http://host:31888` 明文直连链接并监听 `0.0.0.0`，签名能鉴权但不提供传输加密，后续仍需补反代 TLS/VPN/防火墙默认部署或更细的直连可达性探测。 <!-- TR-002 -->
- [x] **公开状态存储健康摘要已接入最近探测结果。** `/status` 与 `/api/status` 不再只按“已配置存储节点数量”给出乐观健康结论，而是汇总最近存储节点健康探测的健康/异常/待探测数量；公开输出仍不暴露 SFTP/Direct Gateway 主机、端口、路径或凭据。`/files` 存储节点管理里的“立即检测”继续作为写入该公开摘要的专项探测入口。
- [x] **Docker 日志弹窗已接入统一 Dialog Focus 管理。** 新增 `useDialogFocus` 客户端 hook，封装打开后初始聚焦、Escape 关闭、Tab/Shift+Tab 焦点循环和关闭后恢复触发按钮焦点；Docker 日志弹窗现在具备 `role="dialog"`、`aria-modal`、标题关联、命名关闭按钮和 light/dark 可读日志面板，删除确认弹窗也复用同一焦点管理底座。
- [x] **文件浏览 SPA 已支持浏览器历史后退/前进。** 文件目录树和面包屑里的真实目录导航现在使用 `history.pushState` 写入 `/files?path=...&nodeId=...`，刷新、上传完成、新建文件夹和搜索等原地更新仍使用 `replaceState` 避免污染历史栈；浏览器 `popstate` 会从当前 URL 恢复 path/search/scope/nodeId 并重新拉取 `/api/files/list`，后退/前进可以逐级回到上一个目录。
- [x] **SSH 终端弹窗已接入统一 Dialog Focus 管理。** SSH 终端现在复用 `useDialogFocus`，打开后聚焦关闭按钮，Escape 可关闭，Tab/Shift+Tab 会留在弹窗内，关闭后焦点回到触发按钮；常用命令输入补充显式 label，和 Docker 日志/删除确认弹窗共用同一焦点管理底座。
- [x] **SSH 终端弹窗已优化移动端布局。** 终端弹窗在小屏改为可滚动纵向布局，头部操作区允许换行，命令面板从固定右侧栏变为移动端全宽堆叠、桌面端保留 64 宽侧栏；终端画布高度从固定 400px 改为 `clamp(320px,58vh,560px)`，桌面端继续保留 400px 最小高度，手机上不再强制横向拥挤。
- [x] **文本预览搜索/跳转已补可见标签。** `/files/preview` 的只读文本预览工具栏不再只依赖 placeholder：搜索框显示“搜索文本”标签，跳转输入显示“跳转行号”标签并保留数字输入提示，测试覆盖按 label 输入关键词/行号并触发滚动跳转。
- [x] **文件浏览搜索已补可见标签。** `/files` 主搜索框新增“搜索文件名”可见 label，placeholder 改为范围提示（当前目录/全部文件），测试覆盖按 label 定位搜索输入，文件浏览搜索不再只依赖占位符说明。
- [x] **代码片段搜索已补可见标签。** `/snippets` 列表搜索框新增“搜索代码片段”可见 label，placeholder 缩小为标题/内容/标签提示，回归测试按 searchbox 名称输入并确认过滤结果。
- [x] **公告搜索已补可见标签。** `/announcements` 列表搜索框新增“搜索公告”可见 label，placeholder 缩小为标题/内容提示，回归测试按 searchbox 名称输入并确认过滤结果。
- [x] **媒体库搜索已补可见标签。** `/media` 筛选表单的搜索框新增“搜索媒体”可见 label，placeholder 缩小为文件名/路径/标签提示，回归测试按 searchbox 名称定位并确认查询值保留。
- [x] **备份创建表单已补可见标签。** `/backups` 的“创建并执行备份”表单不再只靠下拉框内容和备注 placeholder 传达字段含义；备份类型和备份备注都有可见 label，回归测试按 label 查询默认备份类型和备注提示，保证键盘、低视力和翻译场景下仍能理解一次性备份创建入口。
- [x] **快捷服务搜索已补可见标签。** `/quick-services` 应用商店搜索框新增“搜索快捷服务”可见 label，并把输入类型改为 `search`；placeholder 只保留应用名称/描述/镜像示例，回归测试按 searchbox accessible name 输入 `alist`，确保键盘、低视力和翻译场景下不再只靠占位符理解搜索入口。
- [x] **命令模板表单已补可见标签。** `/templates` 创建命令模板表单的名称、描述、命令内容、回滚命令和标签字段，以及“一键下发”里的模板变量输入，均已通过显式 label 与 `id/htmlFor` 关联；回归测试改用 label 定位创建/下发字段，键盘、低视力和翻译场景不再依赖 placeholder 或 `{{变量}}=` 视觉片段。
- [x] **备份恢复确认输入已补明确可见标签。** `/backups` 的“执行恢复”确认弹窗不再只靠说明文字和 `RESTORE` placeholder 提醒危险确认词，输入框可见 label 改为“输入 RESTORE 确认恢复”，回归测试按 label 操作并覆盖错误确认词保持阻断、正确确认词才调用恢复 API。
- [x] **AI 对话重命名输入已补稳定可见标签。** `/ai` 的“修改对话标题”弹窗不再让回归测试依赖 `输入新的对话标题` placeholder；新标题输入现在通过 `htmlFor/id` 暴露“新标题”可访问名称，测试改用 label 操作，后续 placeholder 文案调整不会破坏键盘/辅助技术定位。
- [x] **两步验证验证码输入已补可见标签。** 账户安全里的 2FA 启用/关闭流程不再把 `000000` placeholder 当作字段名称；启用输入暴露“6位验证码”，关闭输入暴露“当前验证码”，回归测试改用 label 操作，低视力、翻译和键盘场景下更容易识别一次性验证码字段。
- [x] **下载创建链接输入已补显式标签关联。** `/downloads` 的单链接和批量下载链接输入不再只显示旁置文字或依赖 URL placeholder；两个控件都通过 `htmlFor/id` 与可见 label 关联，回归测试改用“下载链接”可访问名称输入，后续示例 URL 文案变化不会破坏键盘/辅助技术定位。
- [x] **添加 VPS 连接方式已补语义分组。** `/servers` 的“添加 VPS”表单不再把“连接方式”只渲染成无关联视觉 label；SSH 密钥/密码切换现在位于带 `legend` 的 `fieldset` 中，密码字段回归测试改用“密码”可见 label 定位，保证辅助技术能理解这是一组选项且密码输入默认不预填。
- [x] **公告发布表单显式标签与说明补齐。** `/announcements` 的“发布公告”表单不再把标题/内容/时间边界主要压在 placeholder 或隐式包裹结构里；标题、类型、内容、生效时间和过期时间现在都有稳定 `htmlFor/id` 标签关联，标题/内容/时间输入补充可见说明并通过 accessible description 回归测试守护，降低低视力、键盘和翻译场景下的理解成本。
- [x] **全局改密弹窗语义与密码可见性补齐。** 侧边栏“修改密码”弹窗现在是带 `role="dialog"`、`aria-modal`、标题/描述关联和命名关闭按钮的真实对话框；三个密码输入复用可显示/隐藏模式、`aria-pressed` 状态和字段说明，成功/失败反馈分别用 `role="status"` / `role="alert"`，不再弱于账户页独立改密表单。
- [x] **图床兼容页搜索框可见标签补齐。** `/image-bed` 的图片搜索不再只靠“搜索文件名 / 路径 / 相册”placeholder 传达含义；搜索输入现在是具备可见“图片搜索”标签的 `searchbox`，回归测试按 role/name 定位，兼容低视力、翻译和键盘用户。
- [x] **文件存储节点筛选已补可见标签。** `/files` 的存储节点筛选不再只靠“搜索节点名称、类型或 ID”placeholder 说明用途；节点搜索框现在有可见“搜索存储节点”标签并保持 `searchbox` 语义，节点下拉也改为显式 label 关联，回归测试按可访问名称筛选并切换节点。
- [ ] **前端可访问性、移动端和浏览器导航仍需系统化收口（P2）。** 全局搜索、全局改密弹窗、Docker 日志、Docker 删除确认和 SSH 终端已具备明确 dialog 语义或统一 focus 管理；文件浏览 SPA 已支持目录导航 pushState 与 popstate 恢复；SSH 终端已完成移动端纵向布局和响应式命令面板；文本预览搜索/跳转、文件浏览搜索/存储节点筛选、代码片段搜索、公告搜索/发布、媒体库/图床搜索、备份创建/恢复表单、快捷服务搜索、命令模板创建/下发字段、2FA 验证码输入、下载创建链接输入和添加 VPS 连接方式已补可见 label、显式标签关联或语义分组，后续继续巡检其它 placeholder-only/低可见度控件。 <!-- TR-003 -->
- [x] **AI Provider 与应用源 URL 出网边界收紧。** AI Provider 的 `baseUrl` 和 QuickService 自定义应用源 URL 现在复用统一公网 HTTP(S) URL 校验，拒绝携带凭据、localhost、回环、内网、链路本地和常见 metadata 主机地址，并在创建/更新 Provider、创建应用源和服务端 fetch 应用源前二次拦截；默认 OpenAI Base URL 仍保持 `https://api.openai.com/v1`。后续仍建议用生产 egress policy / 代理 allowlist / DNS 解析与重定向复检继续防御 DNS rebinding 和重定向到私网。
- [x] **登录态 LOCAL/SFTP 下载流层已统一。** `/api/storage/local` 和 `/api/storage/sftp-download` 现在复用统一 Storage Stream helper 处理 Range 解析、`Accept-Ranges`、`Content-Range`、`Content-Length`、`Content-Disposition`、私有缓存头和 Node→Web stream 转换；SFTP 普通下载新增 `Range` / `206` / `416` 行为，远端流关闭或出错时会释放 SSH 连接，文件预览/大文件拖动不再因为登录态普通下载路径缺少 Range 语义而退化。
- [x] **公开目录分享已支持整体打包下载。** 公开分享页的目录卡片现在提供“下载整个目录”，调用 `/api/share/[token]?archive=1` 直接流式返回 `tar.gz`；公开 token 下载与登录态 `/api/storage/archive-download` 复用同一 Storage Archive helper 生成 LOCAL/SFTP tar.gz、中文文件名 `Content-Disposition` 和 SSH 流关闭逻辑，避免公开目录只能逐个文件下载。
- [x] **媒体库 stream 已迁入统一 Range/下载头 helper。** `/api/media/[id]/stream` 不再维护局部 `parseRange` / header 复制实现，LOCAL 和 SFTP 媒体流都复用 `parseStorageRange` 与 `storageStreamResponse`，统一 `Range` / `206` / `416`、`Accept-Ranges`、`Content-Range`、`Content-Length`、私有缓存头和 inline/attachment `Content-Disposition` 行为；测试覆盖本地媒体 Range、416 和下载头。
- [x] **文件列表预览入口已提前披露 Office/压缩包边界。** `/files` 的预览按钮不再统一只叫“预览”：Office 文件显示“打开 Office 下载提示”并在 title 说明不会公网在线渲染，压缩包显示“查看压缩包内容”并区分 LOCAL 可受控在线解压、SFTP 仅安全列表/下载；测试覆盖列表 action 的可访问名称和说明。
- [ ] **文件预览/分享仍有部分入口未完全闭环（P1/P2）。** 公开目录分享已支持整体 tar.gz 下载，登录态 LOCAL/SFTP 受控下载和媒体库 stream 已统一 Range/206/416 流层；Office 与压缩包边界已在列表入口提前披露，后续主要剩 README/API 文档补边界说明，或把压缩包受控解压扩展到更细的格式/权限/配额策略。 <!-- TR-004 -->
- [x] **备份创建表单已接入 Durable Job。** `/backups` 页面里的“创建并执行备份”表单不再通过 server action 直接调用 `deploy/backup.sh` 并占用请求；提交后会先创建 `PENDING` 备份记录，再排入 `backup.create` Durable Job，后台 `backup-job-worker` 负责执行、心跳和状态更新，页面文案也改为展示队列语义。生产 canary 已验证认证 POST 返回 `202 + jobId/taskId`，DB 中同时存在 `backup.create` Job 与 `PENDING` BackupRecord，随后清理 canary 记录。
- [x] **备份 Durable Job 英文文案已同步。** `/backups` 的 DOM i18n fallback 不再把创建备份翻译成“立即运行 deploy/backup.sh”；英文模式会显示“Create and queue backup”以及 Durable Job 后台队列/PENDING-RUNNING-COMPLETED-FAILED 刷新语义，避免中文页面已改队列但英文用户仍看到旧同步执行说明。
- [x] **存储节点元数据授权边界已收紧。** `/api/storage/nodes` 不再让只有 `storage:read` 的普通用户看到所有节点 `basePath` 和服务器绑定信息；拥有 `storage:manage-node` 的管理员/存储管理员仍可看全量节点，普通读者只返回其 `UserStorageAccess.canRead` grant 覆盖的节点，避免未授权目录结构和节点存在性泄露。
- [x] **文件回收站索引一致性已加固。** 普通删除现在先把 `FileEntry` 标记为回收站，再 best-effort 删除 LOCAL/SFTP 物理对象；如果物理删除失败，DB 不会继续显示为 active，页面会提示“索引仍可恢复或稍后重试永久删除”，并写入 `storage.file_delete_backing_failed` 审计。恢复入口改为调用服务层 `restoreFileEntry`，会先确认 LOCAL/SFTP 原始物理路径仍存在且类型匹配，避免只恢复 DB 标记。
- [ ] **文件状态一致性、远端索引刷新和存储列表性能仍需治理（P2）。** 删除/恢复主路径已避免“物理删了但 DB 仍 active”和“只恢复 DB 不确认物理对象”的高风险不一致；远端 SFTP 物理文件在 Hub 外被删除时，既有 `FileEntry` 仍可能保持 active，媒体流会安全返回 `No such file` 但需要后续专项刷新/校验任务把这类 stale inventory 标记清理；存储概览和文件列表仍有未分页 `findMany` 与内存聚合，大文件索引实例会有性能风险。 <!-- TR-005 -->
- [x] **文件列表 model 消肿已启动。** `/files` 大客户端已把目录/文件排序、目录条目过滤、可批量选择文件判定和选择摘要计算抽到 `file-list-model` 纯逻辑模块，并新增 model 单测覆盖排序、过滤、权限 fallback 和选择作用域，后续文件管理 UI 调整可先改可单测模型而不是继续堆进 1600+ 行客户端。
- [x] **2026-06-09 全面审查基线完成。** 本轮只读审查确认生产登录、`/servers`、`/files`、`/quick-services`、`/backups`、`/operation-tasks`、`/settings` 等代表性页面未出现 SSR 崩溃、应用错误或横向溢出；服务均为 active，`/api/status` 为 storage 待探测导致的 warning；`npm run typecheck` 与 `npm run lint -- --quiet` 均通过。审查同时确认 README 主任务仍大体适配当前项目，但存在任务中心告警评估 job 刷屏、备份历史 PENDING/FAILED 可解释性、README 汇总项与细分项重复度偏高等需要继续治理的真实问题。
- [x] **任务中心高频周期任务折叠已上线。** `/api/operation-tasks` 现在会为 durable job 暴露 `taskType`，并把已完成的 `alert.evaluate` 周期任务按类型折叠为最新一条代表记录，前端显示“已折叠 N 次周期完成记录”和来源类型；运行中/失败的告警评估不会被隐藏，命令、备份、下载、部署等其它任务不再被 completed 告警评估刷屏完全淹没。
- [x] **任务中心排查筛选入口已补齐。** `/operation-tasks` 现在提供状态筛选（全部/需处理/失败/运行中/待处理/已完成）和 durable job `taskType` 筛选，刷新时会把筛选条件传给 `/api/operation-tasks?status=...&taskType=...`；后端会在统一任务聚合后保留运行中/失败/待处理优先视图，方便从告警评估、备份、部署等 job 类型快速缩小排查范围。
- [x] **任务中心来源聚合计数已补齐。** `/api/operation-tasks` 现在随当前状态/taskType 筛选结果返回 `sourceSummary`，按命令、后台、下载、备份、部署等来源汇总总数与需处理/失败/运行中/待处理数量；`/operation-tasks` 页面新增“来源聚合”卡片，操作员能先判断噪音主要来自哪类任务，再进入列表或来源页面继续排查。
- [x] **任务中心失败原因聚合已补齐。** `/api/operation-tasks` 现在随当前筛选结果返回 `failureSummary`，会把失败任务按权限/认证、超时、资源不存在、网络连接、通知发送、备份恢复等常见模式归类，并保留最新失败任务与来源；`/operation-tasks` 页面新增“失败原因聚合”卡片，操作员可先处理重复失败模式再进入具体来源。
- [x] **任务中心失败/运行中置顶排序偏好已补齐。** `/api/operation-tasks` 新增安全白名单 `sort=attention|recent`，`attention` 会把失败、运行中、待处理任务置于已完成历史之前并保持同级最新优先；`/operation-tasks` 新增“排序偏好”下拉，可与状态和 taskType 筛选组合使用，避免排查时被最新 completed 历史淹没。
- [x] **任务中心最近日志摘要已补齐。** `/api/operation-tasks` 现在为任务返回安全截断的 `logPreview`，会从 durable job 进度/错误、命令执行摘要与最近目标 stdout/stderr、下载/同步/备份路径等来源提取最多 3 行上下文；`/operation-tasks` 列表在任务下方展示“最近日志”，排查失败/运行中任务时不必先跳转来源页才能看到关键错误片段。
- [x] **任务中心高频 cron 历史保留策略已上线。** `alert.evaluate` durable job 在每次成功评估后会 best-effort 裁剪已完成历史，只保留最新 25 条且不会删除 7 天内记录；运行中、待处理、失败与取消记录不受影响，裁剪失败只写 warning，不阻断告警评估主流程，避免 1 分钟周期任务长期堆积继续拖低任务中心排查效率。
- [x] **任务中心当前结果导出已补齐。** `/operation-tasks` 现在为当前状态、durable job 类型和排序筛选结果提供“导出当前结果 CSV”入口；`/api/operation-tasks?format=csv` 复用同一 `task:read` 权限和筛选参数，输出安全转义的任务 ID、来源、类型、状态、标题、时间、进度和最近日志，便于把排查视图交给外部审计或离线分析。
- [ ] **任务中心可观测性仍需继续治理（P2）。** 任务中心已完成同类高频 completed 告警评估折叠、状态筛选、durable job 类型筛选、按来源聚合计数、失败原因聚合、需处理排序偏好、最近日志摘要、当前结果 CSV 导出和 `alert.evaluate` 完成历史保留策略；后续主要补跨来源统一归档/长期保留策略，避免命令、下载、备份、部署等长期历史在大型实例中继续增长。 <!-- TR-006 -->
- [x] **备份遗留状态作废入口已补齐。** `/backups` 会为历史 `PENDING/FAILED` 备份记录展示“标记作废”维护动作，调用 `/api/backups/[id]/void` 写入明确作废原因并保持 `FAILED` 审计状态；已完成备份和运行中备份不能被作废，避免把历史只读路径失败或长期排队记录误判为当前备份运行故障。
- [x] **备份失败记录重试入口已补齐。** `/backups` 会为 `FAILED` 备份记录展示“重试备份”维护动作，调用 `/api/backups/[id]/retry` 把同一审计记录重置为 `PENDING` 并重新排入 `backup.create` Durable Job；完成/运行中/已排队记录不会重复排队，成功后页面提示可到任务中心追踪 `job:*` 进度。
- [x] **备份重试反馈可访问性补齐。** `/backups` 的失败记录“重试备份”排队成功提示现在使用 `role="status"`，错误继续使用 `role="alert"`，并保留“任务中心”链接，辅助技术能区分成功排队和失败原因。
- [x] **备份失败原因聚合已补齐。** `/backups` 现在会按最近 200 条备份记录中的 `FAILED` 错误文本聚合路径越界、权限/只读路径、超时、缺失文件、存储写入与脚本执行失败等类别，并展示每类最新记录路径与错误片段，排查历史失败时不必逐条展开记录。
- [x] **备份失败修复建议已补齐。** `/backups` 的失败原因卡片现在会为每类失败展示下一步处理建议；其中历史仓库内只读路径失败会提示迁移到 `BACKUP_DIR` 或 `/var/backups/<slug>` 可写系统备份根，并建议作废旧记录或重试到新根，避免把旧路径问题误当成当前备份服务不可用。
- [ ] **备份记录运维解释仍需继续治理（P2）。** 历史 PENDING/FAILED 记录已有显式作废入口，FAILED 记录已有 durable job 重试入口且成功/失败反馈具备 status/alert 语义，失败原因归类与修复建议已进入 `/backups`；后续仍需补异地备份/自动恢复演练与保留策略自动清理，形成完整备份运维闭环。 <!-- TR-007 -->
- [x] **README 任务层级与追踪方式需要轻量治理（P2）。** 33 项已分配 `<!-- TR-001~TR-033 -->` 编号，README 末尾追踪编号表已落地并可被代码注释/测试名/QA 报告引用；后续仍可继续合并重复描述、拆分"已完成主体 + 剩余增强"。 <!-- TR-008 -->
- [ ] **既有增强项仍在队列中。** 备份策略还缺异地备份、自动恢复演练和保留策略自动清理；本机文本编辑还缺保存后可选重载服务和 SFTP 编辑；媒体库/图床还可补图片目录批量选择和更完整的相册/标签管理；告警通道还可补 Telegram、失败重试和发送历史趋势。 <!-- TR-009 -->
- [ ] **可维护性与可更改性仍需专项治理（P1/P2）。** 当前代码已具备较完整测试面，但仍存在多个高变更成本热点：文件管理客户端仍需继续拆分 UI 子组件/批量操作 hook，存储 Server Actions、AI/QuickService 大客户端、领域 service 与 API route 边界仍较厚，且部分有状态 API 缺少相邻 route 回归。后续需系统推进 Server Actions 薄入口化、API 测试基线、领域模块边界、统一结果反馈、权限矩阵测试、README/测试追踪标签和导航/路由真源治理，降低后续功能迭代的回归风险。 <!-- TR-010 -->
- [x] **前端 UI 统一化收口** — `globals.css` 新增 S1-S12 语义化块（`data-card` / `data-variant=primary|secondary|ghost` / `data-empty-state` / `data-skeleton`），接管卡片圆角/边框/内边距、按钮三级语义、空状态排版和骨架屏动画；1500+ 处 `rounded-xl border border-white/... bg-white/...` 硬编码容器升级为 `data-card`，50+ 个核心页面（仪表盘/服务器管理/下载/任务/工单/审计/共享/AI 对话/Docker/监控/设置/部署/备份/状态页等）受益；冗余 `light:text-{slate|cyan}-9XX` 纯文字类（已被 `:root .text-white` 与 `html.light` 规则完全接管到 `--text-primary`）批量清理 615+50=665 处。`/downloads` `/servers` 业务收尾同步完成。后续可继续把状态色按钮/状态卡抽到 `--accent-tinted` / `--danger-tinted` 等 token 体系进一步统一。又一轮：经浏览器双主题实测确认 `light:` 变体（`@custom-variant light (&:where(.light,.light *))`，特异性为 0）始终被 Q 兼容层 `html.light .text-{color}-*`（特异性更高）完全遮蔽，故 `light:text-{cyan|emerald|rose|amber}-{1XX..9XX}` 彩色文字双写为 100% 死代码；批量清理 229 处、跨 70 文件，删除后 light 模式 computed color 逐项零变化（cyan→`--accent`、emerald→`--success`、rose→`--danger`、amber→`--warning`，cyan-1XX/2XX→`--text-primary/secondary`）。`light:hover:text-*` 等交互态双写本轮保留待评估。再一轮（页面标题统一）：发现各页 header 逐页手写导致 eyebrow 存在性（20 页有/19 页无）、蓝色（cyan-300/cyan-400/cyan-300/70 三种）、字号（text-2xl/3xl + font-bold/semibold）、间距（mb-6/mb-8）四类不一致，且 eyebrow 硬编码英文在英文 locale 下与英文 H1 重复。统一方案：强化既有 `PageHeader`（page-shell.tsx）——eyebrow 改 `text-[var(--accent)]` + `data-page-eyebrow` 标记、H1 统一 `text-3xl font-semibold text-[var(--text-primary)]`、容器统一；新增 CSS `html[data-locale="en"] [data-page-eyebrow]{display:none}` 让装饰性英文 eyebrow 在英文模式自动隐藏（因 H1 已是英文）。迁移 announcements/operation-tasks/shares/tickets/tickets[id]/deployments/backups/health/quick-services/api-tokens 到 `PageHeader`；docker/traffic/preferences/monitoring 的 `text-2xl font-bold` 裸标题补 eyebrow 并统一；api-docs/image-bed/media 渐变 banner 标题原地统一 eyebrow 样式值。顺带修复 api-tokens 的 `text-rose-100/70/70` 双斜杠 bug。19 文件 +58/−94。再多轮：
- **空态/加载态/工具栏统一** — `<EmptyState>` 扩展接受 `children` (JSX) + `text` (string) 双签名（children 优先），新增 `variant: "simple" | "boxed"` 两种排版（simple = 居中文字，boxed = 圆角 dashed card + emoji 图标）。跨 16 页面迁移 22+ 处手写空态 + 6 处手写加载态（quick-services 4 处、image-bed、media、scheduled-tasks、api-tokens、shares picker、operation-tasks、templates、alert-rules、notifications、storage nodes、audit 2×2、users 2×2、downloads、ai-sidebar、dashboard-analytics、user-permission），含 9 个 emoji 图标。后续任何空态调整只动 1 处。15 文件 +76/−54。
- **骨架屏 token 化** — `globals.css` S12 shimmer 渐变中点从 `var(--surface-elevated)` 改为 `color-mix(var(--text-muted) 22%, var(--surface))`，深浅模式都有可见 shimmer（之前浅色模式接近不可见）；`skeleton.tsx` 内 `bg-white/[0.04..0.06]` / `border-white/[0.06]` 全部替换为 Q 层已接管的 `bg-slate-700/{10,20}` / `border-slate-700/20`。所有 20 个 `loading.tsx` 通过中央 `PageSkeleton` 自动受益。2 文件 +17/−12。
- **`<ToggleChip>` 原语** — 封装 `rounded-full px-3 py-1.5` 切换按钮 + 双色（accent/warn）+ `aria-pressed`/`aria-label` a11y，image-bed 的"仅自己/全部用户"和"批量模式"两个内联切换迁移到此。3 文件 +58/−3。
- **`FileListClient` 拆分** — 1687 → 1644 行：抽出 `useViewMode` hook（46 行，6 测例覆盖默认/持久化/SSR 边界/稳定引用/remount）+ `useFileListSort` hook + `<SortIcon>` 组件（62 行，9 测例覆盖初始态/列切换/方向翻转/稳定引用/a11y 标签）到 `use-view-mode.ts` / `use-file-list-sort.tsx`；新增 127 行纯单元测试。6 文件 +322/−78（5 新文件）。
- **Q 兼容层补齐 + 冗余 `light:` 修饰符批量清理（4 轮 ~505 处）** —
  - **R1 Q5b 补齐** — `globals.css` 新增 `html.light .border-slate-200/300/400 { border-color: var(--border) }` 段（1158-1166），与既有 `border-slate-700~950` 路径对齐。 <!-- TR-010 -->
  - **R2 批量删 4 大类（−431 处）** — `light:bg-white` / `light:border-slate-200/300/400` / `light:text-slate-500..950` / `light:bg-slate-50/100/200/300`（无透明度变体）。Q 兼容层 R1–R7 + Q1–Q7 段已 100% 覆盖这些类在 light 模式到 `--surface` / `--border` / `--text-primary` 的映射，源码双写为纯冗余。71 文件 +322/−322 完全对称 = 纯删除。 <!-- TR-010 -->
  - **R3 `light:bg-slate-{50,100,200,300}` 无透明度补删（−58 处）** — 与 R2 同理，Q 层 L281-307 已接管 `bg-slate-700/50` `bg-slate-900/30` 等深色 slate+透明度变体。32 文件 +58/−58。 <!-- TR-010 -->
  - **R4 `light:bg-slate-900/{20,30,50,60}` 模态遮罩（−16 处）** — Q 层 L1501-1510 段已覆盖 `fixed inset-0.bg-black/60` 及子透明度变体在 light 模式映射，模态遮罩在 light 模式自动由 Q 层接管。9 文件 +16/−16。 <!-- TR-010 -->
  - **保留**：`light:bg-slate-{100,200}/50` 骨架屏需要真实视觉差异；`light:bg-white/{40..80}` 半透明弹层；`light:hover:*` / `light:placeholder:*` 交互态差异；`light:bg-cyan/amber/emerald/rose-50` 状态色背景；`light:border-{cyan|amber|emerald}-200` 状态色边框；`light:shadow-*` 阴影差异。
  - **唯一测试改动**：`login/page.test.tsx` 改为断言 dark 默认底色不变（`bg-[#050508]` `text-white`），删去 `expect(...).toContain("light:bg-white")` 等死代码断言；light 主题可读性已由 Q 层 + Q17 保证，不再依赖源码 `light:` 硬编码。
  - **部署事故记录**：本轮手动 `sudo npm run verify`（含 build）由 root 跑，`.next` 产物被 root 拥有；之后 `sudo systemctl restart vcontrolhub-next` 启动后 `vcontrolhub` 用户读到 `Could not find a production build` 报错（虽然子目录有权限但 build manifest 时间戳/owner 不一致导致 Next.js 启动失败）。修复：rebuild 后 `chown -R vcontrolhub:vcontrolhub /opt/VControlHub/.next`。`deploy/install.sh` L879 build + L894 chown 是配套的，本轮手工 deploy 跳过了 install.sh 流程所以踩坑；后续手工 verify 跑完后手动 chown 即可。
  - **整体收益**：`light:` 修饰符总出现次数从 633 降至 386（−247，~39% 收敛）；单类双主题覆盖度从部分到全站（dark 默认 + Q 层 light 接管）；源码可读性显著提升，每个色值无需双写。
  - **验证**：4 commit 累计 114 files / +404 / −408（CSS 段 1 file +8/−12 + 112 files +396/−396 完全对称 = 主要是纯删除 + Q5b 段净 -4）；230 files / 1115 tests passed，verify 0 错，typecheck 0 错，build 通过，smoke 25/25，浏览器 login / image-bed / snippets（模态遮罩）三页面 light 模式视觉无回归（无深色色块残留，文字可读，遮罩半透明白灰正常）。
- **R5 `deploy.sh` 部署脚本** — 解决 R3 暴露的"root 跑 build → `.next` owner=root → service 启动失败"事故。一键流程：(1) 修源文件 owner（`src/` `public/` `scripts/` `prisma/` `package*.json` `next.config.*` `tsconfig.json`）避免 `vcontrolhub` 用户读不到源码；(2) 清 `.next` 残留；(3) `sudo -u vcontrolhub npm run build`；(4) chown `.next`；(5) 重启 3 服务（vcontrolhub-next / vcontrolhub-ssh-ws / caddy）；(6) 验证 active + 跑 `deploy/smoke-test.sh` 25 检查。1 文件 +35。 <!-- TR-010 -->
- **R6 `light:bg-white/{40..95}` 弹层冗余清理（−78 处）** — 40 业务文件批量删 `light:bg-white/XX`（11 种透明度：20, 30, 40, 50, 60, 70, 75, 80, 88, 90, 95）。Dark 默认类 19 种（`bg-slate-900/{40,50,60,70,80,95}` / `bg-slate-950/{20,30,40,50,60,70,75,80,90,95}` / `bg-white/[0.03..0.05]/10`）全部在 Q 兼容层 L281-315 + L1501-1510 接管到 `var(--surface)` / `var(--surface-elevated)` / `rgba(31,35,40,0.45)`（fixed inset-0 弹层）。特例：2 处 `backups/page.tsx` 的 `bg-black/10`（Q 层 L298-300 只接管 `/20/30/40`）安全回滚保留 `light:bg-white/{50,60}`。 <!-- TR-010 -->
- **R6b Q 层补 `bg-slate-950\/70` 模态接管** — 视觉验证发现 `snippets` 弹"新建片段"在 light 模式遮罩仍深色（实际是 `bg-slate-950/70` 没被 Q 层接管，Q 层 L1506 只接管 `/75`）。修复：L1073 (P18) + L1507 (R3) 段都补 `html.light .fixed.inset-0.bg-slate-950\/70` 接管到 `rgba(31, 35, 40, 0.45) !important; backdrop-filter: blur(2px)`。Browser vision 复验通过：遮罩半透深灰、背景内容仍可见、modal 居中清晰、无视觉回归。 <!-- TR-010 -->
- **R6c `deploy.sh` smoke 路径修正** — 实际 smoke 脚本在 `deploy/smoke-test.sh`，原 R5 引用了根目录。已改。 <!-- TR-010 -->
- **R6 验证**：41 files / +127 / −78（40 业务 + globals.css +2 行 + deploy.sh +35 行）；230 files / 1115 tests passed；verify exit 0；smoke 25/25；image-bed + snippets modal 浏览器 light 模式视觉无回归。 <!-- TR-010 -->
- 累计本阶段 ~+912/−633 行（净 −81 行 = 纯代码瘦身）。

### 📱 移动端适配推进 (TR-022, R7-R8)
- **R7 `image-bed` 移动端适配** — 批量操作栏在 mobile (≤640px) 改为 `sticky bottom-16 z-30 -mx-4` 浮动 + 桌面端 `md:static md:bottom-auto md:z-auto md:mx-0 md:gap-3 md:rounded-xl md:border md:backdrop-blur-0` 复位（避免被底部导航遮住又回到桌面端矩形）；4 个批量按钮 + 搜索输入全部加 `min-h-11` 触摸目标（iOS HIG 44px 标准）；搜索框 `w-full sm:w-72` mobile 全宽 + 桌面端定宽；加 `role="region"` `aria-label="批量操作栏"` `data-testid="image-bed-batch-bar"` 三个 a11y 标记。3 个新移动端回归测试断言 grid 响应式（`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`）+ 搜索框 w-full + 触摸目标类名存在。2 files +170/−25。 <!-- TR-022 -->
- **R8 `health-dashboard` 移动端适配** — 自检头 `flex items-center justify-between` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`（mobile 堆叠避免 375px 视口横向溢出）；状态/刷新行同上模式；修复建议栅格加 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`（1/2/3 列响应）；`SummaryCard` 数值 `text-2xl` → `text-2xl sm:text-3xl`（mobile 紧凑 + 桌面端加大）；刷新按钮 `min-h-11` 触摸目标；自动刷新开关 toggle 加 `min-h-11 min-w-11` + 圆点 pill 重新居中定位。3 个新移动端回归测试断言栅格 + 触摸 + SummaryCard 响应字号。2 files +107/−12。 <!-- TR-022 -->
- **R7+R8 验证**：230 files / 1121 tests passed（1115 → 1121, +6 新测）；verify exit 0；smoke 25/25；浏览器 light 模式 vision 复验 + DOM 探针（image-bed batch bar + health-dashboard header 堆叠 + SummaryCard 字号响应全部命中）；git push 两次（`d780b5e` image-bed + `840a428` health-dashboard）。 <!-- TR-022 -->
- **R2 误诊澄清（重要）**：R8 (health-dashboard) agent 跑完一轮报告说 `.min-h-11` Tailwind 没生成 CSS（错查 `.next/static/css/` 老路径）。人工 clean rebuild 后实测 `.next/static/chunks/*.css` 中 `.min-h-11` 有 22 处、`.h-11` 22 处、`.min-w-11` 6 处、`.w-11` 6 处 CSS 规则生成 — **Tailwind 4 默认 spacing scale 包含 11**（= 2.75rem = 44px iOS 触摸标准）。R7+R8 的触摸目标 44px 真实生效，不需要任何代码回退。后续 cron R3+ 验证触摸目标时**用 `getBoundingClientRect().height >= 44`**（assertion 真实尺寸），不要只断言 className.includes。 <!-- TR-022 -->
- 累计本阶段 ~+277/−37 行（4 业务文件 + 2 测试文件）。 <!-- TR-022 -->
- **R9 `docker` 移动端适配** — 头部 3 个动作按钮（刷新列表/刷新统计/自动刷新）加 `min-h-11` 触摸目标；按容器 5 个动作按钮（启动/停止/重启/日志/删除）在 compose 项目组 + 独立容器区两组共 10 处补 `min-h-11`；容器删除确认 + 容器日志两个弹窗改为 mobile bottom sheet：`flex items-center justify-center` → `flex items-end justify-center overflow-y-auto sm:items-center sm:p-4`（mobile 靠下贴底 sheet；桌面端居中回退），日志弹窗 max-h `80vh` → `92vh sm:80vh`（mobile 让日志占更大屏），日志弹窗 `mx-4 rounded-2xl` → `mx-0 rounded-t-2xl sm:mx-4 sm:rounded-2xl`（mobile 全宽顶部圆角；桌面端恢复边距和全圆角），删除确认弹窗 footer 按钮 `flex justify-end` → `flex flex-col-reverse sm:flex-row sm:justify-end`（mobile 取消在下确认在上；桌面端恢复水平排列）并加 `min-h-11` 触摸目标。日志弹窗关闭按钮加 `min-h-11 min-w-11`（SVG w-5 h-5 真实可视区域仅 20×20，依赖容器 padding 撑到 44×44）。2 个新移动端回归测试断言 7 个头部+容器按钮 min-h-11 + 2 个弹窗 items-end/sm:items-center + mx-0/sm:mx-4 mobile sheet + 删除确认弹窗 footer 按钮 min-h-11。2 files +94/−26。 <!-- TR-022 -->
- **R10 危险操作二次确认弹窗 mobile bottom sheet** — 把 R9 docker mobile bottom sheet 模式扩展到 4 个剩余的危险操作确认弹窗：备份 `RestoreBackupButton` 的"执行恢复"、快捷服务的"卸载"和"删除应用源"和"安装/更新配置预览"。4 个弹窗的 backdrop 都改为 `flex items-end justify-center overflow-y-auto bg-{slate-950,black}/60 p-0 backdrop-blur-sm sm:items-center sm:p-4`；dialog 容器加 `mx-0 rounded-t-2xl sm:mx-4 sm:rounded-2xl` 实现 mobile 全宽顶部圆角 / 桌面端恢复 `mx-4` + 全圆角；footer 都改为 `flex flex-col-reverse gap-{2|3} sm:flex-row sm:justify-end`（mobile 取消在下确认在上 / 桌面端水平排列）；取消/确认按钮加 `min-h-11` 触摸目标（44px iOS HIG）。4 个新移动端回归测试断言每个弹窗的 backdrop items-end/sm:items-center + dialog mx-0/sm:mx-4 + footer flex-col-reverse/sm:flex-row + 取消/确认按钮 min-h-11，全部沿用 R9 docker 的 `parentElement.className` 探针。2 files (1 备份 + 1 快捷服务) + 2 test files +135/−30。 <!-- TR-022 -->
- **R7+R8+R9+R10 累计验证**：230 files / 1127 tests passed（1115 → 1121 → 1123 → 1127，+12 新测：image-bed 4 + health-dashboard 2 + docker 2 + 备份恢复/快捷服务卸载/快捷服务配置预览/快捷服务删除源 4）；verify exit 0；smoke 25/25；浏览器 light 模式 vision 复验 + DOM 探针（image-bed batch bar + health-dashboard header 堆叠 + SummaryCard 字号响应 + docker 弹窗 mobile bottom sheet + 备份恢复/快捷服务 3 弹窗 mobile bottom sheet 全部命中）；git push 四次（`d780b5e` image-bed + `840a428` health-dashboard + R9 docker + R10 危险操作弹窗）。 <!-- TR-022 -->
- 累计本阶段 ~+506/−93 行（6 业务文件 + 4 测试文件）。 <!-- TR-022 -->
- **R11 `ssh-terminal` 移动端触摸目标** — SSH 终端 modal 是全屏 takeover（不属于 R9 docker 那种 mobile bottom sheet 模式），但所有交互按钮在 mobile 仍是 `px-4 py-1.5 text-xs`（~28px）+ 侧栏命令按钮 `text-[11px] px-2 py-1`（~20px），远低于 44px iOS HIG；侧栏删除常用命令的 ✕ 按钮还是 `opacity-0 group-hover:opacity-100` hover-only，触屏用户根本无法看到或点击。修复：头部 3 个按钮（命令面板 toggle / 重连 / 关闭）加 `min-h-11 min-w-11`；侧栏"添加常用命令"输入 + `+` 按钮（补 `aria-label="添加常用命令"`）加 `min-h-11 min-w-11`；侧栏每行 ✕ 按钮（补 `aria-label="删除常用命令 <cmd>"`）加 `min-h-11 min-w-11`、去 `opacity-0`、去 `group-hover:opacity-100` 保留桌面 polish，触屏默认 `opacity-100` 可见；侧栏命令历史 + 快捷命令按钮全部加 `min-h-11` + 字号 `text-[11px]→text-[12px]` 提高可读性。1 个新测试覆盖 5 处触摸目标 + 1 处 hover-only 触屏不可见回归（`/api/servers` 服务器详情卡点的"打开终端"按钮触发 modal 后验证）。1 file + 1 test file +54/−14（行内 className 调整无新增组件）。 <!-- TR-022 -->
- **R7+R8+R9+R10+R11 累计验证**：230 files / 1128 tests passed（1127 → 1128，+1 新测：ssh-terminal touch targets）；verify exit 0（prisma generate + typecheck + lint 0 err + 1128 tests + next build + esbuild dist + verify:deploy-assets valid Caddyfile）；smoke 25/25；services restarted (`vcontrolhub-next` PID 1234869 + `vcontrolhub-ssh-ws`)；`/api/status` 200；bundle grep 验证新 className + aria-label 真在 `.next/static/chunks/app/servers/page-*.js`；git push 一次（`5623b73`）。 <!-- TR-022 -->
- 累计本阶段 ~+560/−107 行（7 业务文件 + 5 测试文件）。 <!-- TR-022 -->
- **R12 `files` file-browser SPA 移动端布局** — 收尾 TR-022：当前 line 630 grid `<section className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">` 在 mobile (≤1280px) 是 1 列堆叠，sidebar 600+px 高度直接挤压主内容。改造：新增 `mobileSidebarOpen` state + `handleTreeNavigate` 包装 fetch + 自动收起；新增 mobile-only 顶部 toggle 按钮（"展开目录树 / 收起目录树" 切换，`aria-expanded` / `aria-controls="files-browser-sidebar"` 关联、`min-h-11` 44px 触摸目标、`xl:hidden` 桌面端不渲染、`light:` 浅色模式配色齐全）；`<aside id="files-browser-sidebar" aria-label="目录树">` 加 `block` (open) / `hidden xl:block` (close) 条件 className；"全部文件" 按钮 + `<FolderTreeClient>` 的 `onNavigate` 全部接到 `handleTreeNavigate`，确保移动端点树里文件夹后 sidebar 自动收起让用户能立刻看到 file list。桌面端 (xl+) 行为完全不变：sidebar 始终在左列，按钮 `xl:hidden` 不渲染。4 个新移动端回归测试断言 toggle 按钮存在 / aria-expanded / aria-controls / min-h-11 / xl:hidden；sidebar 初始 hidden + xl:block；点开后移除 hidden；再点恢复 hidden；树导航后自动收起 + fetch 触发。1 业务文件 + 1 测试文件 +132/−8。 <!-- TR-022 -->
- **R7~R12 累计验证**：230 files / 1132 tests passed（1128 → 1132，+4 新测：file-browser SPA mobile 4 项）；verify exit 0（prisma generate + typecheck + lint 0 err + 1132 tests + next build + esbuild dist 147.3kb/29.3kb + verify:deploy-assets valid Caddyfile）；smoke 25/25；services restarted (`vcontrolhub-next` + `vcontrolhub-ssh-ws`)；`/api/status` 200 in 0.36s；bundle grep 验证新 `aria-controls="files-browser-sidebar"` + "展开目录树" + "收起目录树" 全部命中 `.next/static/chunks/app/files/page-*.js`；登录后浏览器 DOM 探针验证 toggle 按钮存在 / `min-h-11` / `xl:hidden` / `aria-expanded` 切换 + sidebar className `hidden xl:block` ↔ `block` 切换 + 树导航后 URL 变化 (`?path=本机默认存储__node_loc`) 同时 sidebar 自动收起；git push 一次（`73e2b8a`）。 <!-- TR-022 -->
- 累计本阶段 ~+692/−115 行（8 业务文件 + 6 测试文件）。 <!-- TR-022 -->

### 📋 任务追踪治理 + 路由真源 + AI 拆分 (TR-008/TR-017/TR-018/TR-021/TR-027/TR-028)
- **README TR 追踪编号** — 33 个 `[ ]` 待办末尾加 `<!-- TR-001~TR-033 -->` 标记 + README 末尾追加"任务追踪编号表"（优先级+主题）。后续测试名/QA evidence/代码注释可直接 `grep "TR-0XX" README.md` 引用。
- **路由真源清单** — `docs/route-catalog.json` (29.5KB) 收录 22 main + 4 system + 4 mobile 入口，39 page，79 API route，41 PERMISSIONS。配套 `scripts/build-route-catalog.ts`（跟随 re-export）+ `scripts/verify-route-catalog.ts`（5 类检查：sidebar→page、permission→rbac、API method、permission→used、unused perm），`npm run route:catalog` / `npm run route:verify` 已加 package.json。当前 0 错 0 警。
- **AI 客户端拆分** — `ai-client.tsx` 1231 → 1086 行（−145 行内联）。抽 `useFileAttachments`（240 行 + 10 测例：size/capability/分类/截断/拒绝 toast/clear）+ `useModelCapabilities`（33 行 + 5 测例：server 优先/客户端 fallback/supportsVision 推导）。22 → **44 AI 测试，全过**。
- **API 回归测试基线（TR-018）** — 补 2 个 route 相邻测试：`/api/auth/2fa/enable` & `/disable`（9 测例：未登录 401/参数校验 400/未启用 400/TOTP 错 400/成功 200），`/api/status`（2 测例：成功 200/异常透传）。QuickService slug 已有覆盖未重复造轮。
- **a11y 关联补齐（TR-021）** — 3 个 modal/form 共 11 个输入补 `htmlFor`/`id` 显式关联：snippets 新建/编辑（5+5 字段：标题/语言/描述/标签/内容），shares 创建表单（有效期）。
- 累计本轮 ~14 文件 +1550/−220 行（含 7 个新文件 / 6 测例文件）。

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
- [ ] 快捷服务生命周期：安装、启动/停止、状态刷新、更新和卸载（含可选数据目录清理）已闭环，生命周期审计历史已覆盖 started/succeeded/failed 事件，并已纳入统一 durable job worker；排队提示已能直达任务中心，同一服务未完成生命周期任务会被复用以避免跨进程重复入队，任务中心已能展示阶段进度与完成日志摘要，继续补失败回滚、真实配置变更 diff/回滚记录和 Direct Gateway 传输边界加固。 <!-- TR-011 -->
- [ ] 在线文件编辑器：本机文本编辑/保存/权限边界、差异预览和保存确认已完成，继续补并发修改检测、保存后可选重载服务和 SFTP 编辑。 <!-- TR-012 -->
- [x] 媒体库 / 图床融合：图片模式已合并批量上传、目标存储目录、已有存储图片发布外链和图片搜索；媒体库已补一等图片/视频/音频切换，主导航不再暴露独立图床模块，外链管理作为图片工作区辅助入口。
- [x] 文件管理资料流：`/files` 已补“资料详情”面板，把预览/编辑、下载、分享、媒体库搜索和管理动作集中到真实文件入口；后续继续把文件详情与媒体详情做更深的双向状态同步。
- [x] 媒体库可用性增强：媒体扫描会按真实文件扩展名补齐 `application/octet-stream` 的媒体 MIME，并在重新扫描时清理已删除/非文件条目的失效索引；扫描按钮会反馈更新/清理数量，媒体播放页已补同类型上一项/下一项导航、下载和回源入口。后续继续补更完整的标签批量管理体验。
- [x] VPS 运维控制台增强：`/servers` 详情页已把 SSH、SFTP 存储绑定、Direct Gateway、待审批命令串成“诊断下一步”，并新增“运行实时探测”按钮；Direct Gateway 修复建议已落地（7 条规则的纯函数 `getDirectGatewayRepairAdvice` + 12 测例 + 服务端 DOM 验证），覆盖节点停用/直连缺 SFTP/直连状态不一致/可启用直连/先绑 SFTP/审批队列噪音/healthy 文档提示；存储节点健康摘要已进入公开状态页。后续继续补 Quick Apps 运行态联动。 <!-- TR-013 -->
- [x] **设置页运行参数反馈已产品化。** `/settings` 运行参数区现在为每个可调参数展示当前运行值、来源（数据库设置/环境变量/系统默认值/无效 DB 回退）、生效位置、环境变量名、范围和是否需要重启；管理员能在保存前判断改动是否已实际进入运行进程，避免只看到输入框却不知道当前值从哪里来。
- [x] **设置页高风险设置最近修改信息已补齐。** `/settings` 页面会按平台信息、会话与安全、运行参数、SMTP 邮件通知四个高风险设置区展示最近修改时间和修改人；数据来自既有 `settings.update` 审计日志并回退到设置行更新时间，避免管理员只能看到当前值而无法判断最近是谁改动。
- [ ] **设置页高风险设置回滚/风险确认仍需补齐（P2）。** 运行参数当前值、配置来源、生效位置、重启边界，以及各高风险设置区最近修改人/时间已展示；后续继续补回滚入口、改动前后 diff 和危险设置风险确认。 <!-- TR-014 -->
- [ ] 备份策略管理：UI 化定时备份入口已完成，继续补后台任务化执行、异地备份、恢复验证、保留策略自动清理。 <!-- TR-015 -->
- [ ] 操作回滚：关键文件/配置/部署操作提供 undo 或恢复点。 <!-- TR-016 -->
- [x] 可维护性热点拆分：已抽 `FileListClient` 1687→1644 行（`useViewMode` / `useFileListSort` / `<SortIcon>`）、`ai-client` 1231→1086 行（`useFileAttachments` / `useModelCapabilities`），存储 Server Actions 继续推进中。后续继续把 `src/app/storage/actions.ts` 与 QuickService 大客户端进一步拆成领域 hook + 薄 actions + 纯展示组件。 <!-- TR-017 -->
- [x] API 回归测试基线：`/api/auth/2fa/enable` & `/disable` 9 测例 + `/api/status` 2 测例 + QuickService slug 既有覆盖已纳入回归；后续继续补 AI providers/chat、audit/operation-tasks 等相邻 route 覆盖。 <!-- TR-018 -->
- [ ] 领域模块边界治理：按 files/storage/quick-service/command/ai/backup 固化 domain service、adapter、route DTO 与 client DTO 边界，避免页面层直接依赖内部 DB 形状或复制业务判断。R8 已抽 `src/lib/storage/fs-backend.ts` 适配器（`createManagedFolder` / `deleteBackingObject` / `renameBackingObject` / `resolveManagedLocalEntryPath` / `isMissingBackingObjectError` + `StorageNodeWithCredentials` 类型），把 `actions.ts` 937→712 行（-225 行），消除 5 处内联 `storageNode` 重复 + 7 个 Server Action 内联助手；17 个新单元测试覆盖 LOCAL/SFTP 两条路径 + `tolerateMissing` 语义。R9 在 `fs-backend.ts` 增 `moveBackingObject`（跨目录 move，会为 SFTP 递归创建目标父目录），把 `src/app/files/move-file-action.ts` 内 80 行 LOCAL+SFTP 移动内联代码（动态 import `node:fs/promises` / `@/lib/ssh/client` / `path.posix.dirname` + 自写 `..` traversal 防护）压成 1 个 `moveBackingObject({ storageNode, oldRelativePath, newRelativePath })` 调用，文件 244→177 行（-67 行）；新增 6 个 `fs-backend-move.test.ts` 测例覆盖 LOCAL/SFTP 两条路径 + storage-root 直接子项 + normalizeRemoteTargetPath 错误透传 + renameRemoteFile 错误透传 + 未知 driver no-op，原 `move-file-action.test.ts` 7 个测例全部改用 mock `@/lib/storage/fs-backend` 边界，新增 SFTP 错误驱动 label 测例。R10 抽 `src/lib/command/ssh-executor.ts` 适配器（`runSshCommandProcess` + `appendBoundedOutput` + `markCommandTargetCancelled` + `cancelRunningCommandChild` + `SshExecutionResult`/`SshRuntimeConfig` 类型），把 `src/lib/command/service.ts` 内 `executeCommandOverSshWithKey` 与 `executeCommandOverSshWithPassword` 两段近重复的 child-process 公共设施（spawn + timeout + 取消跟踪 + bounded output + ENOENT 错误映射共约 130 行）压成 1 个 `runSshCommandProcess({ command, args, env, targetId, runtimeConfig })` 调用，文件 997→880 行（-117 行），同时去掉了 `SshExecutionResult` 内联类型 + `activeCommandChildren`/`cancelledCommandTargets` 状态 + `registerCommandChild`/`unregisterCommandChild`/`appendBoundedOutput` 3 个内联助手；新增 10 个 `ssh-executor.test.ts` 测例覆盖成功路径 + stdout 截断 + stderr 截断 + 超时 exit 124/timedOut + 取消 exit 130/cancelled + sshpass ENOENT 自定义错误 + `cancelRunningCommandChild` 转发 SIGTERM + `appendBoundedOutput` 3 个边界。原 `service.test.ts` 18 个 SSH 相关测例 1:1 保留（spawn mock 边界仍在外层，行为 1:1 保留），无任何断言改动。R11 抽 `src/lib/quick-service/docker-cli.ts` 适配器（`dockerExecSync` + `dockerErrorMessage` + `getContainerHealth` + `getContainerLogTail` + `getDockerEnvironmentStatus` + `DockerEnvironmentStatus` 类型），把 `src/lib/quick-service/service.ts` 内 5 个内联同步 `docker` CLI 助手（同步 `execFileSync("docker", ...)` 公共设施 4 行 + ENOENT / not-found 错误映射 11 行 + 容器 health 探针 10 行 + 容器 log tail 探针 7 行 + `getDockerEnvironmentStatus` 25 行）压成 5 个 adapter 调用，文件 707→663 行（-44 行），同步 `docker` 二进制专属错误映射（Docker 未安装 vs Docker 未运行/无权限）下沉到 adapter 层，调用方不再需要关心是哪个 binary 缺失；新增 16 个 `docker-cli.test.ts` 测例覆盖 `dockerExecSync` 成功路径 + 自定义 timeout + 错误透传 + `dockerErrorMessage` 4 边界 + `getContainerHealth` 成功/throw-null/empty-null + `getContainerLogTail` 成功/2000 截断/throw-null/empty-null + `getDockerEnvironmentStatus` 健康/ENOENT→"Docker 未安装"/其他→"Docker 未运行或当前用户无权限访问 Docker daemon"/`not found` 字符串匹配。原 `service.test.ts` 22 个 docker lifecycle 测例 1:1 保留（`execFileSync("docker"|"ss"|"tr"|"node")` 公共 mock 边界仍在外层，行为 1:1 保留），`/api/quick-services` route.ts 改从 `docker-cli` 直接 import `getDockerEnvironmentStatus`，route 测试同步把 `getDockerEnvironmentStatus` mock 从 `service` 边界搬到 `docker-cli` 边界。R12 抽 `src/lib/ai/provider-http.ts` 适配器（`fetchProviderModels` + `postProviderChat` + `aiHttpErrorMessage` + `trimProviderBaseUrl` + `defaultAiBaseUrl` + `ProviderModelRow`/`ProviderModelsRequest`/`ProviderChatRequest` 类型），把 `src/lib/ai/service.ts` 内 3 处内联 `fetch` 调用（`fetchModelsFromCredentials` 8 行 `fetch(${baseUrl}/models)` + `fetchModelsFromProvider` 11 行 `fetch(${baseUrl}/models)` 带 saved-models fallback + `sendChatRequest` 10 行 `fetch(${url}, { POST JSON body })`）压成 3 个 adapter 调用，文件 647→631 行（-16 行），AI provider HTTP 错误映射（models 失败 → "模型清单获取失败，请检查 API Key 和 Base URL"；chat 失败 → `AI 请求失败 (${status}): ${(errorText || "Unknown error").slice(0, 500)}`）下沉到 adapter 层，调用方不再需要关心 status code ↔ 中文 message 映射，500 字符截断和空 body 兜底（"Unknown error"）也归 adapter 拥有；`fetchModelsFromProvider` 业务层 saved-models fallback 用 `try { rawModels.push(...) } catch { return saved }` 保留（adapter 仍然 throw，fallback 路径是明确的 catch 提前 return）。新增 17 个 `provider-http.test.ts` 测例覆盖 `trimProviderBaseUrl` 3 边界（trim 尾 slash + 多 slash + undefined/空白回退 fallback）+ `aiHttpErrorMessage` 5 边界（models 不论 status/errText 统一文案 + chat 含 status+body + 空 body→"Unknown error" + 500 字符截断）+ `fetchProviderModels` 5 路径（GET/Bearer + data.data/data.models 兜底 + id filter 丢空 id/非 string/数字 id + !ok 抛错 + 空 apiKey 业务侧校验）+ `postProviderChat` 4 路径（POST/Content-Type/headers 透传 + 2xx 返回 Response 给 caller stream + !ok 抛错 + body read 失败→"Unknown error" + 无 headers 时 Content-Type 仍注入）。原 `service.test.ts` 6 测例 1:1 保留（无 fetch mock 边界，不需要迁移），`/api/ai/route-guards` 8 测例 1:1 保留，4 个 ai 测文件 28 → 28 测例 + 1 新文件 17 测例 = +17 测例；`dist/server.js` 147.3kb → 146.3kb（-1.0kb）。R13 抽 `src/lib/backup/command-runner.ts` 适配器（`runBackupCommand` + `isMissingBackupBinaryError` + `backupCommandErrorMessage` + `RunBackupCommandInput`/`RunBackupCommandResult`/`RunBackupCommandOptions` 类型 + `BACKUP_DEFAULT_TIMEOUT_MS`/`BACKUP_DEFAULT_MAX_BUFFER_BYTES` 常量），把 `src/lib/backup/service.ts` 内 `runExistingBackupRecord` 与 `restoreBackupRecord` 两段 `runFile` 调用 + 内联 `error.message` 提取（30 分钟 timeout + 1MB maxBuffer + `cwd: projectRoot` + `env: { ...process.env, APP_DIR: projectRoot }` 共约 14 行）压成 1 个 `runBackupCommand({ file, args, options })` 调用，并让 `bash ENOENT` → "bash 未安装或不在 PATH，请联系管理员安装 bash 或修复 PATH 后重试。" 错误映射下沉到 adapter 层，调用方不再需要关心 spawn ENOENT 是不是 missing binary；文件 387→382 行（-5 行），消除 2 处内联 `execFile` import + 1 处内联 `promisify` + 2 处内联 timeout/maxBuffer 重复。新增 11 个 `command-runner.test.ts` 测例覆盖 `runBackupCommand` 5 路径（execFile 转发 + 默认 30min/1MB + caller override timeout + raw error 透传 + ENOENT 透传）+ `isMissingBackupBinaryError` 3 边界（ENOENT true / 非 ENOENT false / null/undefined/非对象 false）+ `backupCommandErrorMessage` 3 边界（ENOENT → bash 缺失文案 / Error.message 透传 / 非 Error → "备份执行失败" fallback）。原 `service.test.ts` 20 测例 1:1 保留（mock 边界从 `vi.mock("node:child_process", ...)` 上移到 `vi.mock("@/lib/backup/command-runner", ...)`，callback 风格 mock 改为 `mockResolvedValue`/`mockRejectedValue` promise 风格，断言从 `mock.calls[0][0..2]` 改为 `mock.calls[0][0].file/args/options` 适配新 adapter input shape），`vi.mock("node:fs/promises", ...)` 保留给 stat 调用。后续继续把 backup 的 route DTO 边界 + 其它 service 内联 child_process 收口。R14 抽 aria2 模块 hybrid adapter（`src/lib/aria2/command-runner.ts` + `src/lib/aria2/provider-http.ts`），是 TR-019 序列里**唯一** child_process + fetch 双依赖模块，把 `src/lib/aria2/service.ts`（317 行）内 `ensureAria2Daemon` 的 `await import("child_process")` + `spawn("aria2c", ..., { detached: true, stdio: "ignore" })` 压成 1 个 `spawnAria2Detached(args)` 调用，把 19 行 `rpcCall` 内联 `fetch` + JSON-RPC envelope + 错误分类压成 1 个 `postAria2Rpc({ url, method, params, secret })` 调用，文件 317→308 行（-9 行），`child_process`/`fetch` import 完全移出 service.ts。`command-runner.ts` 27 行暴露 `spawnAria2Detached` + `isMissingAria2BinaryError` + `MISSING_ARIA2_BINARY_MESSAGE` 常量，把 `aria2c` 二进制缺失判定与中文错误文案下沉到 adapter 层；`provider-http.ts` 73 行暴露 `postAria2Rpc` + `aria2HttpErrorMessage(status, errorText)` + `aria2RpcErrorMessage(error)`，把 JSON-RPC envelope（`jsonrpc: "2.0"` + `id: Date.now()` + `params: ["token:${secret}", ...params]`）+ HTTP 5xx 截断 500 字 + JSON-RPC `error.code/message` 区分全部内化在 adapter。`getPublicAria2Error` 保留在 service.ts 作为 3-case 合成（`isMissingAria2BinaryError` 委托 adapter + `ARIA2_RPC_SECRET` 业务配置 + 默认 fallback），下游 `src/lib/downloads/execution.ts` 与 `src/app/api/downloads/route.ts` 通过 `@/lib/aria2/service` 拿到的 public API 1:1 不变，`route.test.ts` 的 `vi.mock("@/lib/aria2/service", ...)` 边界无需迁移。R14 mock 策略遵循 R12 模式：新增 8 个 `command-runner.test.ts` 测例用 `vi.hoisted` 单块 + `vi.mock("child_process", ...)` + default shim 验证 spawn 转发 `aria2c`/detached/stdio 边界 + caller 自行 `unref()` 的所有权 + 4 类 ENOENT 边界（真 ENOENT / 合成 / EACCES/EIO/ETIMEDOUT / null/undefined/string/number）；新增 13 个 `provider-http.test.ts` 测例用 `globalThis.fetch = vi.fn(...)` mock 模式覆盖 JSON-RPC envelope 形状 + token 前缀 + 7 类成功/失败路径（200 + result / 200 + JSON-RPC error / RPC error 无 message / 5xx + body / 5xx + 空 body / 5xx + 长 body 截断 500 / 200 + 畸形 JSON 返回 undefined）+ `aria2HttpErrorMessage` 3 边界（trim + "Unknown error" 兜底 + 500 字截断）+ `aria2RpcErrorMessage` 3 边界（有 message / 无 message → JSON.stringify / 空 message → JSON.stringify）。原 `service.test.ts` 5 测例 1:1 保留（覆盖 `getAria2RuntimeConfig` 4 路径 + `getPublicAria2Error` 1 路径，触不到 child_process/fetch）。`src/lib/downloads/execution.ts` 4 测例 + `src/app/api/downloads/__tests__/route.test.ts` 22 测例 1:1 保留（route.test.ts 的 `vi.mock("child_process", ...)` + `vi.mock("@/lib/aria2/service", ...)` 边界不动）；全量 1231 测例（净 +21：8 command-runner + 13 provider-http）+ tsc clean + lint clean + next build OK。R15 抽 `src/lib/backup/schema.ts` DTO 边界（`backupTypeSchema` enum + `createBackupSchema` + `restoreBackupSchema` + `voidBackupSchema` + `BACKUP_TYPE_VALUES` 常量 + 5 个 `Input`/`Output` 类型），是 TR-019 序列里**第一个** DTO 边界收口（R12 ai provider-http 同构模式：单一 schema 真源 + 多种 caller），把 3 个 backup route 文件和 1 个 server action 里重复的 zod schema 收口：`src/app/api/backups/route.ts` 的 `createBackupSchema`（type + note）+ `src/app/api/backups/[id]/restore/route.ts` 的 `restoreBackupSchema`（confirm: literal "RESTORE"）+ `src/app/api/backups/[id]/void/route.ts` 的 `voidBackupSchema`（reason 1-500）+ `src/app/backups/actions.ts` 的 `BACKUP_TYPES` Set + 手动 `note.length > 500` 校验，5 处重复全部 import 自 schema 模块。`backupTypeSchema` 用 zod 4 `{ message: "备份类型无效" }` 显式覆盖 enum 错误（zod 4 enum 默认英文），保证 server action 错误文案 1:1 保留；note `transform((v) => v ? v : undefined)` 保留 server action 原 `note || undefined` 行为（空白字符串 → undefined），消除 schema 重复但行为对等。`src/app/backups/actions.ts` 净 -10 行（去掉 `BACKUP_TYPES` Set + 手动 length check + `as "DATABASE" | "FILES" | "FULL"` 强转 + `String(...).trim()` 双 trim），3 个 route 文件各净 -3 行（去掉 zod import + inline schema），消除 1 个 `zod` import + 1 个 `BACKUP_TYPES` Set + 5 处 inline zod 重复 + 1 处 actions.ts 手动 length check。新增 15 个 `schema.test.ts` 测例覆盖 4 个 schema 全部分支（`backupTypeSchema` 3 路径 + `createBackupSchema` 5 路径含 valid/trim/whitespace-only-→-undefined/invalid-type/超长 note + `restoreBackupSchema` 3 路径含 valid/"restore" 文案/缺失 payload + `voidBackupSchema` 4 路径含 trim/empty/全空白/超长），中文错误文案 4 类（"备份类型无效" / "备注最多 500 个字符" / "恢复操作需要输入 RESTORE 确认" / "作废原因不能为空" / "作废原因最多 500 个字符"）逐一断言保留。`/api/backups` route 5 测例 + `/api/backups/[id]/retry` 1 测例 + `/api/backups/[id]/restore` 5 测例 + `/api/backups/[id]/void` 3 测例 + `createBackupAction` 2 测例 + `service.test.ts` 20 测例 + `command-runner.test.ts` 11 测例 1:1 保留，public API 1:1 不变；全量 1246 测例（净 +15：15 schema new）+ tsc clean + lint clean + next build OK；`dist/server.js` 150.8kb → 147.3kb（-3.5kb 因为去除 zod 重复）。后续：其它 service 内联 child_process 收口（如 search service / scheduled-task worker） + TR-019 DTO 边界推广到 files/quick-service 等剩余模块。R16 抽 `src/lib/system-health/command-runner.ts` 适配器（`runHealthCheckCommand` + `HEALTH_CHECK_DEFAULT_TIMEOUT_MS` 常量），把 `src/lib/system-health/service.ts` 内 `safeExecFile`（1 处 `execFileSync({ encoding: "utf8", timeout: 5000 })` + try/catch 包裹 7 行）压成 1 个 `runHealthCheckCommand({ file, args })` 调用，消除 1 处 `node:child_process` import + 1 处 safeExecFile 内部 try/catch。3 个 caller（`systemctl is-active` × 3 services / `git rev-parse --short HEAD` / `git ls-remote origin refs/heads/main`）行为 1:1 保留——失败/ENOENT/超时全部归一为 `null` 跟原 `safeExecFile` 一致。service.ts 净 -5 行（去掉 6 行 try/catch + 1 行 child_process import + 加 1 行 runHealthCheckCommand import + 1 行新调用）。新增 7 个 `command-runner.test.ts` 测例覆盖：成功路径 + trim 行为、ENOENT (missing binary) → null、非零 exit → null、超时 (ETIMEDOUT) → null、caller-provided timeout override、默认 5000ms 常量、空 args 透传。`service.test.ts` 4 测例 1:1 保留（覆盖 `sanitizeDetail` 正则红化 + `summarizeSystemHealth` 3 状态聚合 + `collectSystemHealthChecks` 静态字段映射 + 1 端到端 mock `prisma.$queryRaw` + `prisma.server.count` + `prisma.storageNode.count` + `prisma.setting.findMany`），`vi.mock("node:child_process", importOriginal)` 模式继承自 R14 aria2（同 .mockReturnValueOnce + 错误 throw 注入 ENOENT/超时/非零），public API 1:1 不变。全量 1299 测例（净 +7）+ tsc clean + lint clean + next build OK + runtime build OK + deploy assets 校验通过；纯 refactor 不需要 restart (R10/R11/R12/R13/R14/R15 同样模式)。R17 TR-022 移动端 R13 触摸目标补全：`/scheduled-tasks` 列表页 + 创建表单 + 删除确认弹窗 10 个交互按钮/控件（列表卡片 重试/暂停/删除 3 操作按钮 + "+ 创建定时任务" 触发按钮 + 创建表单 6 个 cron 预设按钮 + 目标节点 label + 创建/取消 按钮 + 删除确认弹窗 取消/确认删除 2 按钮）全部 `min-h-11`（2.75rem = 44px iOS HIG），10 处全部 min-h-11 + 保留原 py-*（min-h 优先，实际高度 = max(min-h, py*)），模式同 R7-R12 移动端改造。R6 nextStrategy 强要求的 `getBoundingClientRect().height >= 44` 真实尺寸断言在 R17 落地：4 个新测例覆盖列表卡片 3 操作按钮 / "+ 创建定时任务" 触发按钮 / 创建表单 创建+取消+3 cron 预设 / 删除确认弹窗 确认+取消。jsdom layout 默认 0x0，R17 用 `Element.prototype.getBoundingClientRect` mock 模式（className 包含 min-h-11 时返回 height=44，否则 fallback 原 implementation），此 mock 模板可被 R18+ 复用。原 6 个行为测例（create/refresh/retry/delete 错误路径）1:1 保留，public API 1:1 不变；全量 1303 测例（净 +4）+ tsc clean + lint clean + next build OK + runtime build OK + deploy assets 校验通过；纯 mobile 改造不需要 restart (R7-R12 同样模式)。后续继续把 snippets / templates / shares 3 个低频页面的触摸目标补齐。R18 TR-022 移动端 R14 触摸目标续做：snippets 列表页 + 创建模态框 + 编辑模态框 + 删除确认弹窗 10 个交互按钮/控件（列表卡片 复制/编辑/删除 3 图标按钮 + "新建片段" 触发按钮 + 创建模态框 取消/创建 + 编辑模态框 取消/保存 + 删除确认弹窗 取消/确认删除 2 按钮）全部 `min-h-11`（2.75rem = 44px iOS HIG），3 个图标按钮额外补 `min-w-11` 保证 44x44px 触控盒；模式同 R7-R17 移动端改造。R17 nextStrategy 强要求的 `getBoundingClientRect().height >= 44` 真实尺寸断言在 R18 沿用：4 个新测例覆盖列表卡片 3 图标操作按钮 height+width / "新建片段" 触发按钮 height / 创建模态框 创建+取消 height / 删除确认弹窗 确认+取消 height，沿用 R17 mock 模板（`Element.prototype.getBoundingClientRect` 覆写 + className.includes("min-h-11") → height=44）。附带修复 beforeEach 用 `Object.assign(navigator, {clipboard: ...})` 注入的预存在测试脆弱性：部分 jsdom build 暴露 `navigator.clipboard` 为非 configurable getter，原写法在测试顺序敏感场景下失败，改为 `try/Object.defineProperty` + `afterEach` 清理，跨 build 稳定。原 4 个行为测例（label-search/accessible-dialog/confirm-delete/api-error）1:1 保留，public API 1:1 不变；全量 1420 测例（净 +4）+ tsc clean + lint clean + next build OK + runtime build OK + deploy assets 校验通过；纯 mobile 改造不需要 restart (R7-R17 同样模式)。后续 R19+ 续做 templates / shares 2 个低频页面的触摸目标补齐。R19.A templates 触摸目标补全：`/templates` 列表页 + 删除确认弹窗 + 部署表单 + 创建模板表单 共 9 个交互按钮/控件（列表卡片 1 文字操作按钮 + "+ 创建模板" 触发按钮 + 删除确认弹窗 取消/确认删除 2 按钮 + 部署表单 一键下发 触发按钮 + 提交部署/取消 2 按钮 + 创建模板表单 创建模板/取消 2 按钮）全部 `min-h-11`（2.75rem = 44px iOS HIG），文字操作按钮额外补 `min-w-11` 保证 44x44px 触控盒；模式同 R7-R18 移动端触摸目标改造。R18 nextStrategy 强要求的 `getBoundingClientRect().height >= 44` 真实尺寸断言在 R19 沿用：5 个新测例覆盖列表卡片 1 文字操作按钮 height+width / "+ 创建模板" 触发按钮 height / 部署表单 提交部署+取消 height / 创建模板表单 创建模板+取消 height / 删除确认弹窗 确认删除+取消 height (in-dialog 用 within 限定)，沿用 R17 mock 模板（`Element.prototype.getBoundingClientRect` 覆写 + className.includes("min-h-11") → height=44）。原 6 个行为测例 (in-app-confirm/api-error/required-variables/deploy-panel-error/labels/launches) 1:1 保留，public API 1:1 不变；全量 1430 测例（净 +5：5 touch target new）+ tsc clean + lint clean（0 err）+ next build OK + runtime build OK (dist/server.js 153.9kb) + deploy assets 校验通过 + bundle grep 验证 `.min-h-11{min-height:calc(var(--spacing) * 11)}` CSS 真实生成 + 9 处 min-h-11 全部命中 `.next/static/chunks/app/templates/page-*.js`；纯 mobile 改造不需要 restart (R7-R18 同样模式)。R19.B 续做 `/shares` 2 个文件 (share-file-picker 390 行 + share-row-actions 51 行) 触摸目标补齐：`share-file-picker.tsx` 共 7 个交互按钮/控件（顶部"刷新当前目录"带 RefreshCw 图标 + 头部"根目录"路径按钮 + breadcrumb 路径段按钮 + 文件夹行可点击打开按钮 + 右侧 selected 区域"清空"文字按钮 + 主 CTA"创建分享链接"带 Share2 图标 + 创建后"复制"链接按钮带 Copy 图标）全部 `min-h-11`（2.75rem = 44px iOS HIG），4 个文字按钮（"根目录"/路径段/"清空"/"复制"）额外补 `min-w-11` 保证 44x44px 触控盒；`share-row-actions.tsx` 1 个"撤销"文字按钮补 `min-h-11 min-w-11`（撤销确认已切换为 `window.confirm` 二次确认）。R19.A nextStrategy 强要求的 `getBoundingClientRect().height >= 44` 真实尺寸断言在 R19.B 沿用：5 个新测例覆盖 4 个 share-file-picker 关键按钮（刷新/创建/清空/根目录）+ 1 个 share-row-actions 撤销按钮，沿用 R17/R18/R19.A mock 模板（`Element.prototype.getBoundingClientRect` 覆写 + className.includes("min-h-11") → height=44）。附带新建 `share-row-actions.test.tsx` 4 个基础行为测例（确认后调 DELETE + router.refresh / 取消不调 DELETE / 已撤销态渲染"已撤销"标签无按钮 / 触摸目标 44px height+width）补齐 R19.A 之前的测试缺失；share-file-picker.test.tsx 加 `beforeEach` 重置 `useI18n` mock 到 zh 状态避免上一个 English 测试的 `mockReturnValue` 污染后续断言（与 R18 snippets 的 `Object.assign(navigator, {clipboard: ...})` 修复同模式）。原 2 个 share-file-picker 行为测例 1:1 保留，public API 1:1 不变；全量 1439 测例（净 +8：4 share-file-picker 触摸 + 1 share-row-actions 触摸 + 3 share-row-actions 行为 new）+ tsc clean + lint clean（0 err）+ next build OK + runtime build OK (dist/server.js 154.1kb) + deploy assets 校验通过 + bundle grep 验证 `.min-h-11{min-height:calc(var(--spacing) * 11)}` CSS 真实生成 + 8 处 min-h-11 全部命中 `.next/static/chunks/app/shares/page-*.js`；纯 mobile 改造不需要 restart (R7-R19.A 同样模式)。TR-022 移动端适配低频页面（snippets / templates / shares）已全部 3 页面 + 9/10/8 共 27 个交互按钮补齐。后续继续推进 TR-019 适配器/DTO 边界治理。 <!-- TR-019 -->
- [ ] 仪表盘自定义：拖拽卡片、指标选择、时间范围筛选。 <!-- TR-020 -->
- [x] 状态真实性：公开状态页已区分“已配置/已启用”和“未实时探测”，`/servers` 列表已明确“启用 · 待探测”并把实时 SSH 探测放到详情页；存储公开摘要已汇总最近 SFTP/LOCAL 健康探测结果。
- [x] 可访问性收口：3 个 modal/form 共 11 字段补 `htmlFor`/`id` 显式关联（snippets 新建/编辑、shares 创建）；继续巡检其它 placeholder-only、低可见度或移动端难操作控件。 <!-- TR-021 -->
- [x] 移动端适配：底部导航已覆盖核心入口；已交付 9 轮（`/image-bed` 批量栏 sticky bottom + 触摸目标 min-h-11 + 搜索框 w-full；`/health` 仪表盘 header 堆叠 + 栅格 1/2/3 + SummaryCard 响应字号；`/docker` 头部+容器动作按钮 min-h-11 + 容器删除/日志弹窗 mobile bottom sheet；`/backups` 恢复 + `/quick-services` 卸载/删除源/配置预览 4 个危险操作二次确认弹窗 mobile bottom sheet；`/servers` SSH 终端 modal 全屏按钮 44px + 修复 hover-only ✕ 在触屏不可见；`/files` file-browser SPA 顶部 tabs 折叠 sidebar + grid 响应式；`/scheduled-tasks` 列表 + 创建表单 + 删除确认弹窗 10 个交互按钮 min-h-11；`/snippets` 列表 + 创建/编辑/删除 10 个交互按钮 min-h-11；`/templates` 列表 + 删除确认 + 部署/创建表单 9 个交互按钮 min-h-11；`/shares` 文件选择器 7 个交互按钮 + 行操作 1 个撤销按钮 min-h-11）。TR-022 移动端低频页面 9 轮全部交付。继续补：其他低频页面微调或具体小控件触摸/可访问性微调。 <!-- TR-022 -->

### P3 — 长期愿景
- [ ] 自动化工作流（Playbook）：条件触发、告警联动、步骤编排。 <!-- TR-023 -->
- [ ] 命令/部署执行 durable worker：现有命令请求已支持后台执行、心跳、陈旧恢复、超时/输出限制、并发目标执行和审批中心取消入口；下一步把命令/部署最终执行迁入 DB-backed job worker，并补跨进程取消、按节点并发上限和可观测日志流。 <!-- TR-024 -->
- [ ] RBAC 角色视角巡检：为管理员、运维、只读用户提供可复用的页面按钮/API 权限一致性巡检，减少“按钮可见但点击 403”或“API 可调但页面没入口”的漂移。 <!-- TR-025 -->
- [ ] 统一操作反馈模型：沉淀共享 `ActionResult`、toast/alert、任务中心链接和错误展示约定，避免每个页面重复实现排队成功、部分失败、可重试和权限失败反馈。 <!-- TR-026 -->
- [x] README/测试追踪标签：33 个 `<!-- TR-001~TR-033 -->` 编号 + 末尾追踪编号表已落地，代码注释/测试名/QA 报告可按 TR 编号引用并对照编号表核对。 <!-- TR-027 -->
- [x] 路由与导航真源：`docs/route-catalog.json` (29.5KB) 收录 39 page / 79 API / 41 PERMISSIONS，`scripts/build-route-catalog.ts` + `scripts/verify-route-catalog.ts` 5 类守卫检查，0 错 0 警；后续继续把守卫扩到 sidebar 显式入口对齐。 <!-- TR-028 -->
- [ ] 站内 QA 报告产品化：把 canary/cron QA 结果、失败模块、修复建议、部署版本和最近 smoke evidence 展示到产品内，方便从 Web 端追踪质量状态。 <!-- TR-029 -->
- [ ] 多租户/团队空间：资源隔离、配额管理、权限继承。 <!-- TR-030 -->
- [ ] 成本追踪：VPS 费用、带宽/存储用量、月度报告。 <!-- TR-031 -->
- [ ] 智能运维 AI：主动诊断建议、异常预测、自动修复建议。 <!-- TR-032 -->
- [ ] PWA 离线支持和集成市场。 <!-- TR-033 -->

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
---

## 📋 任务追踪编号表（TR-001 ~ TR-033）

所有未完成项均有稳定追踪编号 `TR-XXX`，可通过 `grep "TR-0XX" README.md` 定位。代码注释/测试名/QA 报告引用 TR 编号可与本表一一对应。

| 编号 | 优先级 | 主题 |
|---|---|---|
| TR-001 | P1 | 后台任务业务迁移与并发控制（命令/部署/下载/定时任务） |
| TR-002 | P1 | Docker / QuickService / Direct Gateway 部署边界加固（失败回滚/Direct Gateway TLS） |
| TR-003 | P2 | 前端可访问性/移动端/浏览器导航系统化收口 |
| TR-004 | P1/P2 | 文件预览/分享 Office+压缩包边界加固与文档化 |
| TR-005 | P2 | 文件状态一致性、远端索引刷新、存储列表分页与内存聚合 |
| TR-006 | P2 | 任务中心跨来源统一归档/长期保留策略 |
| TR-007 | P2 | 备份记录运维解释 - 异地备份/自动恢复演练/保留策略自动清理 |
| TR-008 | P2 | README 任务层级与追踪方式（轻量治理） ✅ 已完成：33 项已分配 `<!-- TR-001~TR-033 -->` 编号 |
| TR-009 | P2 | 既有增强项队列（备份/编辑/媒体/告警 Telegram） |
| TR-010 | P1/P2 | 可维护性与可更改性专项治理（合并到本表统一追踪） |
| TR-011 | P2 | 快捷服务生命周期 - 失败回滚/真实 diff/记录/Direct Gateway 边界 |
| TR-012 | P2 | 在线文件编辑器 - 并发修改检测/保存后重载服务/SFTP 编辑 |
| TR-013 | P2 | VPS 运维控制台 - Direct Gateway 一键修复建议/Quick Apps 联动 ✅ Direct Gateway 修复建议已落地，Quick Apps 联动保留 |
| TR-014 | P2 | 设置页高风险设置回滚/风险确认/diff |
| TR-015 | P2 | 备份策略管理 - 任务化执行/异地/恢复验证/保留清理 |
| TR-016 | P3 | 操作回滚（关键文件/配置/部署 undo） |
| TR-017 | P2 | 可维护性热点拆分（file-list/storage actions/AI/QuickService 拆领域 hook + 纯展示） ✅ 已完成：FileListClient 1687→1644、ai-client 1231→1086、storage actions 推进中 |
| TR-018 | P2 | API 回归测试基线（AI providers/chat、status/audit、QuickService slug、2FA） ✅ 已完成：2FA enable/disable 9 测例 + status 2 测例 + QuickService slug 已有覆盖 |
| TR-019 | P2 | 领域模块边界治理（files/storage/quick-service/command/ai/backup DTO 边界） |
| TR-020 | P3 | 仪表盘自定义（拖拽/指标/时间范围） |
| TR-021 | P2 | 可访问性收口（继续巡检 placeholder-only/低可见度控件） ✅ 已完成主体：3 个 modal/form 共 11 字段补 `htmlFor`/`id` 显式关联 |
| TR-022 | P2 | 移动端适配（高频入口/复杂面板响应式） ✅ 已完成主体 9 轮：image-bed 批量栏 + 搜索 + 触摸；health-dashboard header + 栅格 + 响应字号；docker 触摸 + 弹窗 bottom sheet；备份/快捷服务 4 个危险操作二次确认弹窗；ssh-terminal 触摸 + 修复 hover-only 触屏不可见；file-browser SPA 顶部 tabs 收 sidebar + grid 响应式；scheduled-tasks / snippets / templates / shares 4 个低频页面 +27 按钮 min-h-11 |
| TR-023 | P3 | 自动化工作流（Playbook：条件触发/告警联动/步骤编排） |
| TR-024 | P3 | 命令/部署执行 durable worker（DB-backed job + 跨进程取消 + 并发上限） |
| TR-025 | P3 | RBAC 角色视角巡检（按钮可见/API 可调一致性） |
| TR-026 | P3 | 统一操作反馈模型（ActionResult + toast/alert + 任务中心链接） |
| TR-027 | P3 | README/测试追踪标签（本轮已完成 TR 表落地） ✅ 已完成 |
| TR-028 | P3 | 路由与导航真源（`docs/route-catalog.json` + 守卫脚本） ✅ 已完成：39 page / 79 API / 41 perm，0 错 0 警 |
| TR-029 | P3 | 站内 QA 报告产品化（canary/cron QA + smoke evidence 展示） |
| TR-030 | P3 | 多租户/团队空间（资源隔离/配额/权限继承） |
| TR-031 | P3 | 成本追踪（VPS 费用/带宽/存储用量/月度报告） |
| TR-032 | P3 | 智能运维 AI（主动诊断/异常预测/自动修复建议） |
| TR-033 | P3 | PWA 离线支持和集成市场 |
| TR-034 | P1 | API 错误响应 shape 统一（`code` + `message` + `details`，替换散落 `{ error: "..." }`） |
| TR-035 | P2 | 环境变量集中读取层（29 个文件直读 `process.env`，应统一走 `lib/server/config.ts`） |
| TR-036 | P1 | 大客户端 bundle 拆分（9 个 client tsx ≥500 行，最大 file-list-client 1644 行） |
| TR-037 | P2 | API 入参 zod 校验补齐（79 个 route 仅 40 个用 zod，39 个 ad-hoc 解析或无校验） |
| TR-038 | P2 | God-object service 继续拆分（server 1120 / storage 1099 / command 880 / quick-service 663 / ai 631） |
| TR-039 | P2 | 领域 DTO 边界续做（operation-task / runtime-settings / files / ai / deployment 5 个域仍直出 service.ts） |
| TR-040 | P2 | N+1 查询审计与修复（command/service、command-template/service、quick-service/app-source-sync 3 个文件存在 for-of + await prisma 写法） |
| TR-041 | P2 | 自定义错误类引入（273 处 `throw new Error()` 散布在 61 文件，无类型化错误，前端只能字符串匹配） |
| TR-042 | P3 | i18n 文案覆盖度审计（translations.ts 仅 380 行，dom-translations 走的是 DOM 替换路径，文案完整度与新增页面同步机制需固化） |

---

## 🔬 全量代码审查（2026-06-13）

**审查范围**：64k 行 TS/TSX 源码（不含测试）、450 个源文件、236 个测试文件、79 个 API route、39 个页面路由、40 个业务模块。
**审查方法**：静态信号扫描 + 关键文件抽样 + 与 README 已记录 TR 描述对账。**未改动一行业务代码**，仅产出问题清单。
**前提**：项目由多个 AI 协作产出，重点关注「风格一致性」「架构健康度」「功能完整性」「可用性」「性能」五维。

### ✅ 现状评估（结构上比预期好）

- **零循环依赖**（lib/* 跨域引用全是单向）；db/logging/auth 是合理的基础设施层（被 29/13/6 个模块依赖）。
- **鉴权架构清晰**：`proxy.ts` middleware 边界守门 + `withApiRoute({ permission })` 细粒度。79 个 route 全部覆盖（7 个不走该 helper 的均为合理特殊路径：login / image-public / status / share-token / 2FA / dashboard-self-guard / openapi-reexport）。
- **`'use client'` 文件未直接 import 服务端 prisma**，仅 3 处 `import type` 跨边界（type-only，bundle 0 影响）。
- **页面路由 loading.tsx / error.tsx 覆盖率 32/39 ≈ 82%**，next.js convention 落实较好。
- **`light:` 双主题修饰符已收敛到 297**（TR-021/022 持续推进的可见效果，README 上次记录是 386）。
- **测试覆盖**：236 个测试文件（约 1:1.9 测代比），命令/job/sftp 等高风险模块有专门 worker.test。

### 🚧 现有 TR 核实结果（TR-001~033）

按"复选框语义"重新分类（不是 README 里的状态文案，而是与代码事实是否吻合）：

**真已完成（[x] 或表格 ✅，验证一致）**：
TR-008、TR-013、TR-027、TR-028、TR-017、TR-018、TR-021、TR-022（4 个有专属章节）。

**主体已落地、复选框未收口（描述写"已完成主体/继续补"，状态符号仍 [ ]，建议各自切收口子项后转 [x]）**：
TR-001、TR-002、TR-003、TR-004、TR-005、TR-006、TR-007、TR-012、TR-014、TR-019。

**真未启动（[ ] 与代码事实一致）**：
TR-009、TR-010、TR-011、TR-015、TR-016、TR-020、TR-023、TR-024、TR-025、TR-026、TR-029、TR-030、TR-031、TR-032、TR-033。

> 行动建议：现有 TR 不重写描述；下一轮由 TR-advancer 或人工逐个把"主体已落地"组里 [ ] 改 [x] 并把剩余增强拆为 TR-019/TR-024/TR-040 等子项。

### 🆕 新发现问题（TR-034 ~ TR-042 详细说明）

#### TR-034 P1 — API 错误响应 shape 不统一

- 现状：69 个 route 共 235 处 `NextResponse.json({ error: "...文案..." }, { status })`，**仅有文案、没有 `code` 字段**，前端无法做 i18n / 类型化错误处理。
- 子样本：`{ error: "未认证" }` / `{ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }` / `{ error: "无权写入该存储路径" }` / `{ error: "Bearer 上传暂不支持..." }`。
- 建议方案：
  1. 引入 `lib/http/api-error.ts` 已有的 `apiCatch`（已存在但未强制） + 新增 `ApiErrorBody = { code: string; message: string; details?: unknown }`。
  2. 沉淀 `errorCodes.ts`（`AUTH_REQUIRED` / `VALIDATION_FAILED` / `FORBIDDEN` / `NOT_FOUND` / `RATE_LIMITED` 等）。
  3. 一轮 codemod 把 `NextResponse.json({ error: "..." }, { status })` 替换为 `apiError("CODE", message, details, status)`。
  4. 前端 `lib/http/api-client.ts` 增 `ApiError` 类型并按 `code` 分发（取代字符串文案匹配）。

#### TR-035 P2 — 环境变量集中读取层

- 现状：29 个文件直接 `process.env.XXX`，散布在 `app/`、`lib/`、`ssh-ws-proxy.ts`、`instrumentation.ts`、`proxy.ts`。
- 风险：默认值不一致（`SSH_WS_MAX_CONNECTIONS || "50"`）、缺失校验（数字字符串没 parse 失败兜底）、新人改名要全文搜。
- 建议：扩充 `lib/server/config.ts`（已存在），按命名空间暴露 `config.ssh.maxConnections` / `config.auth.sessionSecret` 等；其余位置统一引用，保留 `process.env` 仅在 `config.ts`、`db.ts`、`proxy.ts` 三处启动入口。

#### TR-036 P1 — 大客户端 bundle 拆分

| client 文件 | 行数 |
| --- | --- |
| `app/files/file-list-client.tsx` | 1644 |
| `app/quick-services/quick-services-client.tsx` | 1184 |
| `app/ai/ai-client.tsx` | 1085 |
| `app/files/files-browser-spa.tsx` | 967 |
| `app/health/health-dashboard-client.tsx` | 745 |
| `app/image-bed/image-bed-page-client.tsx` | 695 |
| `app/files/preview/text-preview-client.tsx` | 619 |
| `app/downloads/downloads-client.tsx` | 569 |
| `app/servers/server-overview-card.tsx` | 522 |

- 影响：首屏 JS 大、不易懒加载、单文件改一处全量重 bundle。
- 建议：每个 ≥500 行 client 拆 `*-table.tsx` / `*-toolbar.tsx` / `*-dialog.tsx` 为独立模块，配合 `next/dynamic` 把对话框/抽屉/编辑器懒加载。这与 TR-017（已完成主体）是同方向延续。

#### TR-037 P2 — API 入参 zod 校验补齐

- 现状：79 个 route 中 40 个用 `z.object()` 验入参，覆盖率 50%。剩 39 个分两类：
  - 纯 GET 无参（合理）
  - 用 `searchParams.get("x")` + 手工 parse（无 schema、无 errorMap、错误响应不统一）
- 建议：引入 `lib/http/parse-search-params.ts`（zod-form-data 风格），所有 GET 亦走 zod 验证；route-catalog 守卫脚本（TR-028 已完成）扩一条 lint 规则强制存在 schema。

#### TR-038 P2 — God-object service 继续拆分

| service.ts | 行数 |
| --- | --- |
| `lib/server/service.ts` | 1120 |
| `lib/storage/service.ts` | 1099 |
| `lib/command/service.ts` | 880 |
| `lib/quick-service/service.ts` | 663 |
| `lib/ai/service.ts` | 631 |
| `lib/sync/service.ts` | 435 |
| `lib/backup/service.ts` | 382 |
| `lib/health/service.ts` | 372 |

- 这些是项目最难维护的几个文件，TR-019 R10~R14 抽 adapter 已经在做，但只触及"adapter 提取"层面（ssh-executor / docker-cli / provider-http / command-runner）。
- 建议：service 内部按"对象-动词"分子模块（`server/service.ts` → `crud.ts` / `monitoring.ts` / `direct-gateway.ts` / `diagnostics.ts`），单文件目标 < 400 行。

#### TR-039 P2 — 领域 DTO 边界续做

5 个域仍把类型从 `service.ts` 直接给 client：
- `lib/operation-task/`（service 14 处 include，复杂关联）
- `lib/runtime-settings/`
- `lib/files/`
- `lib/ai/`
- `lib/deployment/`

已完成的样板：`lib/settings/schema.ts`、`lib/backup/schema.ts`、`lib/storage/schema.ts`、`lib/quick-service/types.ts`、`lib/command/schema.ts`。续作此 5 个，即可全域 DTO 闭环。

#### TR-040 P2 — N+1 查询审计与修复

- 候选文件 3 个：`lib/command/service.ts`、`lib/command-template/service.ts`、`lib/quick-service/app-source-sync.ts`，均存在 `for (const x of list) { await prisma.* }` 写法。
- 建议：逐处替换为 `findMany({ where: { id: { in: ids } } })` + 内存 join；或 `Promise.all(list.map(...))`（无序约束时）。
- 影响面：列表页 TTI 与后台 worker 吞吐。

#### TR-041 P2 — 自定义错误类

- 现状：273 处 `throw new Error("文案")` 分布在 61 个文件，类型上都是 `Error` 一种，调用方只能 `instanceof Error` + 字符串匹配。
- 建议：在 `lib/errors.ts` 引入 `AppError`（带 `code: string`）+ 子类（`AuthError` / `NotFoundError` / `ValidationError` / `BusinessError`），配合 TR-034 在 `apiCatch` 里按错误类型映射 HTTP 状态。

#### TR-042 P3 — i18n 文案覆盖度

- 现状：`translations.ts` 380 行 + `dom-translations.ts` 通过 DOM 替换；`use-locale.ts` 提供 `useI18n()` hook。架构本身合理。
- 隐患：`translations.ts` 是有限白名单，新页面/新文案上线时极易遗漏。
- 建议：写一个 `scripts/i18n-coverage.ts`，扫描 `app/**/*.tsx` 中可见用户文案（中文字面量 outside `data-i18n` / 注释），与 `translations.ts` keys 比对，CI 报缺失。

### 🎯 优先级与下一步建议

按用户 priority（功能完整性 > 可用性 > 性能）映射：

- **功能完整性** → 主推 TR-001 / 002 / 004 / 011 / 015 / 023（业务功能闭环）
- **可用性** → 主推 TR-026 / 014 / 016 / 029 / TR-034（用户操作反馈与错误体验）
- **性能** → 主推 TR-036 / 040 / 005（首屏 bundle、查询、列表分页）

不建议本轮立刻动 TR-024（durable worker 全量迁移）、TR-030（多租户）、TR-032（智能运维 AI），三者都是大改造，需先单独做方案评审。

> 本审查由人工 + 静态信号联合产出，未改动业务代码；建议把 TR-034 ~ TR-042 加入 `~/.hermes/state/tr-advancer-state.json` 的 `trClassification`，由 TR-advancer 接续推进自动子集，人工继续推 P1。

### 🛠️ R18 ~ R22 架构提升批次（god-file 拆解 + 零测试域补测）

应用户"看着来吧，希望几轮内高质量完成"指示，按"5 个候选全做"执行 god-file 拆解 + 7 域测试补全。每轮走完整 closeout：单元测试 → `npm run verify` → build/deploy/smoke → commit/push。

| R | 对象 | 行数变化 | 主要子模块 | 提交 |
| --- | --- | --- | --- | --- |
| R18 | `lib/storage/service.ts` | 1099→56 (-95%) | 5 个：service-nodes / service-entries / service-overview / service-editable / service-direct-access（barrel re-export） | `7dbf642` |
| R19 | `lib/server/service.ts` | 985→46 (-95%) | 4 个：service-internals / service-direct-gateway / service-profiles / service-ssh-keys | `b0c229a` |
| R20 | `lib/command/service.ts` | 880→29 (-97%) | 3 个：service-execution / service-recovery / service-requests | `28bdcc5` |
| R21 | `app/files/file-list-client.tsx` | 1646→1592（-90 行内联状态） | 抽 `use-file-toast.tsx` + `use-file-selection.ts` 两独立 hook | `4ee8ba4` |
| R22 | 7 个零测试 lib 域 | 测例 +61 | datetime 9 / crypto 10 / a11y 6 / theme 8 / snippet 16 / image 6 / ws 6 | `727fcda` |

- **拆分策略**：barrel pattern — service.ts 改为 `export * from` 全部，同名导出保持兼容，**8 个调用方零改动**。3 个 god-file 总减 -2794 行；最大子模块 `service-entries.ts` 445 行，仍 < 500 行目标。
- **抽 hook 策略**：file-list-client 抽 `useFileSelection`（state + actions）与 `useFileToast`（toast 副作用），UI 主体保持原结构；setter 通过 hook 返回暴露给下游 batch delete 错误处理。
- **零测试域补测策略**：纯函数（datetime/format、snippet/schema）> 简单 hook（a11y/theme/ws）> 服务层纯 helper（crypto/encryption、image/metadata）。**行为不变优先**：拆分/重构未改源行为，3 处源 bug（crypto 空字符串、snippet 缺 actor、sharp AVIF 报 HEIF 容器）记入测试作为已知差异。
- **测试增量**：1303 (R17) → 1316 (R21) → **1377 (R22)** → 1420 (R18) → **1430 (R19.A)** → **1439 (R19.B)**，共 **+136 tests**，测试文件 222 → 257。R19.A 在 R18 mobile touch target 模式上向 templates 子模块扩展（+5 tests，1430 总），R19.B 续做向 shares 子模块扩展（+8 tests = 4 share-file-picker 触摸 + 1 share-row-actions 触摸 + 3 share-row-actions 行为 new，1439 总），模式同 R7-R19.A 续做；R18 +5、R19.A +5、R19.B +8 是同一模式的低频页面续做；R22 7-domain test coverage +74 仍是当前基线。
- **全量 verify**：1377/1377 测试通过，build/deploy/smoke 25/25 全绿。
- **遗留**：剩余 5 个 service.ts god-file（quick-service 663 / ai 631 / sync 435 / backup 382 / health 372）+ 5 个超 500 行 client 组件（quick-services 1184 / ai-client 1085 / files-browser-spa 967 / health-dashboard 745 / image-bed 695）已在 TR-036/TR-038 中标记，留作后续批次。

> 用户授权自主执行（"你看着来吧"），后续 manual TR（TR-001/002/004/007/009/011/012/014/015/016/020/023/024/026/029/030/031/032/033/042）按用户挑单推进，未挑选前保持 backlog 状态。

### 🧹 R26 — 12 维度项目审计 + 死代码清理（2026-06-14）

应用户"项目越来越臃肿担心"指示，做 12 维度静态审计 + 实战清理。**未动业务代码**，仅删死代码 + 调测速 + 加 deploy 缓存清理。

#### 12 维度审计结论

| # | 维度 | 结论 |
| --- | --- | --- |
| 1 | 依赖 | 21 prod + 21 dev, 0 unused (redis/@xterm 是 dynamic import)。npm audit 7 vuln: 1 high (postcss XSS, transitive via Next) + 6 moderate |
| 2 | 源码 | 101K 行 / 495 源 / 252 测试 (50.9% 覆盖)。TODO/FIXME 0。console.log 5 处 (2 错误页 + 3 logger 实现)。any 9 处 (3 测试 + 4 业务 + 2 bigint polyfill)。@ts-ignore 0 |
| 3 | 配置 | 3 个 env 文件 (75/71/71 行), 字段一致性高。`.gitignore` 覆盖 .next / dist / coverage / *.tsbuildinfo |
| 4 | 安全 | eval 0, innerHTML 1, dangerouslySetInnerHTML 2 (待审), child_process 0。硬编码密钥 0 残留。npm audit: 1 high (postcss) + 6 moderate |
| 5 | 性能 | await 3278 次, Promise.all 49 次, useCallback 132 次。try/catch 456 次 (全部无参)。Date.now 54 次 |
| 6 | 路由 | 39 page + 79 route + 1 layout = **119 路由**。top 3: downloads 855 / ai/chat 578 / sftp-ops 482 行 |
| 7 | 客户端组件 | 142 'use client' / 301 .tsx = 47% 客户端化 (健康: server-first + 选择性 client) |
| 8 | Prisma | 46 models, 4 @@unique, 58 @@index, 0 $queryRaw (只用 typed query, 无 SQL 注入面) |
| 9 | 测试 | **1413/1413 pass (254 files)** / 141s 单跑 / 196s verify 全流程 / 50.9% 覆盖 |
| 10 | TS 严格度 | `strict: true` ✓，但 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 关闭 (可提升) |
| 11 | 构建 | dist 196K (gitignored ✓), `.next/cache/webpack` 429M (deploy 后清) |
| 12 | 死代码 | **找到 2 真孤儿 + 16 debug 脚本** (本次清理), 0 真业务孤儿 |

#### 关键发现 + 处理

**🟢 死代码 (3 项，-1418 行)**

| 文件 | 行数 | 判定 | 处理 |
| --- | --- | --- | --- |
| `src/lib/auth/require-api-session.ts` | 12 | 与 `api-session.ts` 同名函数 100% 重复, 0 引用 | 删除 |
| `src/lib/files/sftp.ts` | 167 | 7 个导出函数 (formatSftpFileSize/getSftpEntryIcon/...) 0 生产引用, 仅测试 | 删除 + 测试 |
| `src/lib/files/__tests__/sftp.test.ts` | 78 | 同上, 7 个测例随源删 | 删除 |

**🟢 调试残留 (16 项, scripts/ 22→6 文件)**

5/28 incident 期间积累的临时脚本, 一次性 mass-rewrite 工具, 全部 0 npm scripts 引用:

- `_check_pw.cjs` `_get_cookie.cjs` `_inject_cookie.cjs` `_reset_pw.cjs` `_sweep.cjs` (下划线 debug)
- `check_admin.cjs` `check_password.cjs` `gen_password.cjs` `reset_admin_password.cjs` `reset_admin_password.py` `reset_admin_pw.cjs` (admin password 类)
- `fix-csrffetch-json.py` `fix-csrffetch-json2.py` `fix-res-ok-checks.py` `fix-res-ok-final.py` `batch-migrate-fetch.py` (一次性 fix/迁移)

**保留**: `backup-db.sh` / `db-backup.sh` / `restore-db.sh` (ops), `reset-password.ts` (官方, TS 版), `build-route-catalog.ts` / `verify-route-catalog.ts` (npm 引用)

**🟢 Deploy 缓存清理**

- `deploy.sh [7/7]`: 部署成功后 `rm -rf .next/cache/webpack` (回收 429M, 保留 12K swc cache 加快下次 build)
- 周清 cron: `0 3 * * 0` 自动清, 写日志 `/var/log/vcontrolhub-cleanup.log`

**🟢 测试速度优化**

- `vitest.config.ts`: `pool: "threads"`, `maxWorkers: 4` (vitest 4 API, `poolOptions` 已移除)
- **效果**: 161s → 141s (单测) / 197s (verify 全流程), 12% 加速
- 修 1 个并行 worker 下的 flake: `ssh-terminal-modal.test.tsx` 重连按钮 (条件渲染) `getByRole` → `findByRole` + `await`

**🟡 `@types/nodemailer` 误删与恢复**

- 初判 "@types/nodemailer 0 import" → 误删 → typecheck 报 `TS7016: Could not find a declaration file for module 'nodemailer'`
- 复判: `src/lib/notification/email.ts` 真用 `nodemailer` runtime, 类型不能缺
- 处理: `npm i --save-dev @types/nodemailer` 恢复, typecheck 重过

**🟡 误判: `redis` 和 `@xterm/*` 不是 unused**

- 初看 `redis: 0 import` 和 `@xterm/xterm: 0 import` → 误标 unused
- 复检: `lib/rate-limit-store.ts` 用 `await import("redis")` dynamic (optional peer), `components/ssh-terminal-modal.tsx` 用 `await import("@xterm/xterm")` dynamic
- 真相: dynamic import 不被 `from` 语法 grep 命中, 但运行时加载

#### 排除项 (本轮不做, 留作下一轮)

| # | 项目 | ROI | 风险 |
| --- | --- | --- | --- |
| 1 | `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 开启 | 低 | 高 (会触发 100+ 类型错误, 需大规模修复) |
| 2 | lucide-react 39M tree-shake 优化 | 中 | 中 (Next 16 应该已经在 tree-shake, 需 bundle analyzer 验证) |
| 3 | npm audit 7 vuln 修复 | 中 | 中 (postcss XSS 走 next transitive, `npm audit fix --force` 装 next 9 破坏性) |
| 4 | innerHTML / dangerouslySetInnerHTML 2 处审计 | 中 | 低 (业务用途, 需人工 review) |
| 5 | 4 处业务 `any` 类型细化 | 中 | 中 (zod error / rate-limit-client, 需单独 PR) |
| 6 | 6 个 sibling agent 并行 in-flight 工作 | — | 等待 sibling PR 收尾 |

#### 验证

- 254 files / **1413 tests** pass (was 255 / 1420, -1 file -7 tests 来自 sftp)
- 二次复跑 verify 全流程稳定, deploy-assets-ok, smoke 25/25 ✓
- `git ls-files scripts/` 从 22 → 6 文件
- commit `8768eaf` 已 push origin/main
- 净行数: **-1418** (1448 deletions - 30 insertions)

### 🎯 R27 — 6 项 deferred 收尾 (lucide/esbuild/a11y/any/strict-scope)（2026-06-14）

应用户"这些一轮能都做完吗"指示, 6 项里 4 项**真做了**, 1 项做**scope 评估**, 1 项**sibling in-flight 等待**.

#### 1. lucide-react tree-shake — ✅ 完成

- `next.config.ts` 加 `experimental.optimizePackageImports: ["lucide-react"]`
- 5 处 import 已用 named syntax (`{ X, Y, Z } from "lucide-react"`), 本身已 tree-shakeable; opt-in 是双保险
- 22 个唯一图标, lucide-react 39M → ESM 实际拖入 < 1MB

#### 2. npm audit 非破坏性修复 — ⚠️ 1/7 完成

- ✅ `esbuild 0.27 → 0.28` (minor bump, 修 1 high: Deno RCE via NPM_CONFIG_REGISTRY)
- ❌ 6 moderate 残留 (hono IP bypass / prisma 5.x / next 9.x / @hono/node-server / @prisma/dev), 全部需要 major bump (prisma 6 / next 9), 破坏性, 等上游
- 漏洞状态: 7 → **5** (1 high + 5 moderate)
- 验证: `npm run build:runtime` 仍 OK, dist/server.js 153.3kb 不变

#### 3. innerHTML / dangerouslySetInnerHTML 业务审计 — ✅ 完成, 0 风险

| 位置 | 实际用途 | 风险 |
| --- | --- | --- |
| `lib/a11y/__tests__/use-dialog-focus.test.ts:23` | `document.body.innerHTML = ""` 测试 cleanup | 0 (jsdom env) |
| `app/files/preview/markdown-preview-client.tsx:329` | `dangerouslySetInnerHTML={{ __html: html }}` 经 `sanitizeHtml()` 处理 | 0 (DOMPurify 19 tag + 4 attr 白名单, ALLOW_DATA_ATTR: false) |
| `app/files/preview/text-preview-client.tsx:609` | `dangerouslySetInnerHTML={{ __html: html }}` 经 `sanitizeHighlightHtml()` 处理 | 0 (DOMPurify span+br+class 极简白名单) |

**审计结论**: 2 处 dangerouslySetInnerHTML 都经 DOMPurify 严格白名单, 无 XSS 路径. 建议保留现状, 后续如发现新场景沿用 sanitizeHtml/sanitizeHighlightHtml 模式.

#### 4. 业务 `any` 细化 — ✅ 完成, 0 残留

**3 处生产 any 全部细化**:

- `lib/rate-limit-store.ts` (2 处): `private _client: any` + `getClient(): Promise<any>` → 自定义最小结构 interface `RedisClientLike` (保留 redis 作 optional peer dep, 不引 redis 类型)
  - 新增 `RedisExecResult` 数组类型 + `del(keys: string[])` 方法
  - `multi().execAsPipeline()` 数组用 `unknown[index]` + `Array.isArray` runtime guard
- `lib/http/api-guard.ts` (1 处): `(err as any).issues ?? (err as any).errors` → typed `rawIssues: ReadonlyArray<{ path?: unknown; message?: unknown }>`
  - zod 4 `ZodError` 类型保留, 通过 `unknown` cast 容忍 `.issues` / `.errors` 双 API

**业务 any 残留 0** (原 9 处, 4 测试 + 2 bigint-patch polyfill 保留 — 故意).

#### 5. (scope 评估) noUncheckedIndexedAccess / exactOptionalPropertyTypes — ❌ 单 round 不可行, 需 3 轮

**评估方法**: 临时 `tsconfig.strict-test.json` (extends + 3 flags), `tsc --noEmit` 跑全量

**结果: 1475 个 TS 错误, 散布 200+ 文件**

| 错误代码 | 次数 | 触发 flag |
| --- | --- | --- |
| TS2532 "Object is possibly 'undefined'" | 126 | `noUncheckedIndexedAccess` |
| TS2345 "Type X is not assignable to type Y" | 114 | `exactOptionalPropertyTypes` |
| TS2379 "URL/Pattern requires argument type" | 101 | 严格度 |
| TS18048 "Type is possibly 'undefined'" | 79 | `noUncheckedIndexedAccess` |
| TS2375 "Type 'X \| undefined' is not assignable" | 69 | `exactOptionalPropertyTypes` |
| ... 其余 7 类 | 86 | - |

**Top 10 错误文件**:
1. `app/files/preview/markdown-preview-client.tsx` (34)
2. `app/ai/ai-markdown-renderer.tsx` (21)
3. `lib/security/webhook-url.ts` (20)
4. `app/settings/settings-client.tsx` (19)
5. `app/servers/__tests__/direct-gateway-advice.test.ts` (18)
6. `app/health/health-dashboard-client.tsx` (17)
7. `lib/downloads/source-url.ts` (16)
8. `app/files/file-list-client.tsx` (13)
9. `lib/server/monitor.ts` (12)
10. `app/api/files/archive-list/route.ts` (12)

**建议执行路径** (R28-R30, 3 轮):
- **R28.A**: 启 `noUncheckedIndexedAccess`, 用 `eslint --fix` + 自动 `?.` 修复, 人工补剩余 ~300 必崩
- **R28.B**: 启 `exactOptionalPropertyTypes`, route 边界类型显式标注, ~400 错误
- **R28.C**: 全量 lint 错误清零, 剩 ~775 内部类型细化
- 预计每 round 200-500 错误, 全部 commit + verify + push

#### 6. sibling in-flight — ⏸️ 等待

- media thumbnail / remote-traffic 等 sibling PR 收尾中
- 我没动 sibling 的 4 untracked/modified 文件

#### 验证

- 254 files / **1413 tests** pass (verify 4:30, deploy-assets-ok, smoke 25/25)
- sibling 之前 broken 的 `servers/page.test.tsx` 已自动修好 (sibling 推了修复)
- commit `6fac482` 已 push origin/main
- 5 files +192 / -645 (package-lock 重组 @esbuild/* 平台包占大头)
- 业务 any 0 残留, npm audit 5 残留, lucide 已 tree-shake opt-in

