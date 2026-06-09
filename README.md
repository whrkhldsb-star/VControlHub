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
- [x] **下载任务记录删除回归补齐** — `/api/downloads?purge=1` 的终态任务删除路径新增回归测试，确认完成/失败/取消记录只删除历史行、不触碰远端下载进程，并且运行中任务会先要求取消，避免“删除记录”和“取消任务”语义混淆。

- [x] **文件创建表单可见标签补齐** — `/files` 的“新建文件夹”展开表单不再只依赖 placeholder 或屏幕阅读器隐藏文本传达输入含义；目标存储节点和文件夹名称现在都有可见标签，回归测试也改用 label 查询，保证键盘、低视力和翻译场景下仍能明确知道每个输入的作用。

### 目前仍存在的问题 / 使用边界

- [x] **在线文本文件编辑权限边界收紧** — `/api/files/editable/[id]` 读取和保存现在都会把当前 session 传入存储服务，并在解析 LOCAL 文件条目后调用 `assertStorageAccess` 校验对应存储节点与相对路径；读取需要具体 `read` 授权，保存会按新内容字节数校验 `write` 授权/配额，避免只有全局 `storage:read/write` 的用户通过文件条目 ID 绕过细粒度路径授权。
- [x] **远端文件代理范围收紧** — `/api/servers/[id]/file-proxy` 启动临时 Python 代理前必须确认服务器绑定了 SFTP 存储节点，生成脚本时把 `SERVE_DIR` 限制到该节点 `basePath`，并在目标主机内做 realpath 边界校验；代理现在优先使用 `Authorization: Bearer` 或 `X-VControlHub-Proxy-Token` header 校验 token，只保留 query token 作为旧客户端兼容兜底，同时把 CORS 从 `*` 收紧到发起请求的 Hub origin 并补充 `Referrer-Policy: no-referrer` / `nosniff`。
- [x] **统一 Durable Job 队列底座已落地。** 新增 DB-backed `jobs` 表与 `JobStatus`，提供 enqueue、lease claim、heartbeat、retry/fail、cancel、stale RUNNING recovery、progress/result/error 记录等通用服务；任务中心已把 durable job 纳入统一聚合，后续备份/恢复、SFTP 同步、QuickService 安装/更新、下载执行和告警评估可以逐步迁移到同一队列，而不是继续各自依赖请求内长任务或进程内 fire-and-forget。
- [x] **命令执行可取消入口已产品化。** `/requests` 审批中心现在会在待审批/已批准/运行中的命令请求上展示“取消命令”操作；审批人可填写可选原因，经 CSRF 保护调用 `/api/commands` 取消接口，后端会终止当前进程内仍在运行的 SSH 子进程或把未完成目标标记为 `CANCELLED`，页面成功后刷新状态，失败时保留弹窗并用独立错误提示区展示原因。
- [ ] **后台任务业务迁移与并发控制仍在进行（P1）。** Durable Job 底座目前已承接 SFTP 同步、备份创建、备份恢复和告警评估；命令执行已具备后台 SSH 执行、心跳、陈旧 RUNNING 恢复、输出/超时 guardrail、并发目标执行和用户可见取消入口。后续仍需把命令/部署、QuickService、下载 direct/relay、定时任务补实际 durable worker，补全局/按用户/按节点并发上限、可观测日志流和生产级 worker 部署策略。
- [x] **备份/恢复已迁入 Durable Job。** 备份创建先持久化 `BackupRecord`，再由 `backup.create` worker 执行 `deploy/backup.sh`；恢复 API 会先校验备份存在和 `RESTORE` 确认，再排入 `backup.restore` worker 执行恢复，避免 30 分钟脚本继续占用 HTTP 请求。旧调用可通过 `?wait=1` 保留同步执行路径，后续继续补异地备份、自动恢复演练、保留策略自动清理和更细进度日志。
- [x] **告警评估已迁入 Durable Job。** 告警 worker 不再直接在定时器内调用 `evaluateAlerts()`；每轮先去重排入/认领 `alert.evaluate` job，再通过共享 job service 记录 heartbeat、失败重试、完成结果和 workerId，任务中心可以看到告警评估的运行状态，进程重启或失败时也不会只留下不可见的定时器日志。
- [x] **邮件告警通道已接入 SMTP** — SMTP 设置页新增告警收件人配置，保存时校验并规范化邮箱列表；告警测试发送现在会真实调用 SMTP 邮件通道并返回发送/拒收结果，真实告警评估也会在 `email` 渠道选中时 best-effort 发送邮件，不再是“可选但不可发送”的死路径。后续仍可继续补失败重试和发送历史。
- [x] **快捷服务卸载闭环补齐** — 已安装快捷服务现在不仅有卸载确认弹窗，还可以选择是否同时删除该服务模板记录的宿主机数据目录；默认仅删除容器和数据库记录并保留 `/opt/`、`/srv/` 下数据，勾选后才会清理允许范围内的挂载目录，且不会删除 Docker socket、时区文件或根目录，避免“一键卸载”只停在容器层或误删共享宿主资源。
- [x] **部署真实回滚已落地。** 命令模板可配置独立 `rollbackCommand`，部署运行会保存不可变 `DeploymentSnapshot`（模板名、部署命令、回滚命令、变量和目标服务器），`/deployments` 的“执行真实回滚”会创建 `DeploymentRollbackRun` 并把快照里的回滚命令送入原有审批/命令执行链路；“重新提交部署”仅作为兼容操作保留并明确标注。后续可继续补失败自动回滚策略、按版本保留/清理、回滚前差异检查和更完整的演练报告。
- [x] **AI Hosted Tools 授权边界已收紧。** 托管工具执行授权下沉到 `hosted-service`：自动批准的只读 SSH 工具即使从聊天流或后续服务调用触发，也必须携带具备 `server:ssh` 的会话上下文；危险工具审批改为必须具备 `ai:action:approve`，不再允许原请求者自批自己的高风险操作，批准后的执行还会再次校验审批人的 `server:ssh`。`/api/ai/hosted-actions/[id]` 现在由共享 API guard 强制 `ai:action:approve`。后续仍可继续补服务器所有权/按节点细粒度授权、只读日志目录白名单和审批人分离审计报表。
- [x] **QuickService 访问边界已显式化。** 快捷服务运行概览和已安装卡片不再只给一个“访问”按钮：访问 URL 现在会生成结构化描述，明确标注“公开直连端口”或“反代 HTTPS”，并在按钮标题/可访问名称里提示直连端口不会经过 VControlHub 登录鉴权，需依赖防火墙、VPN 或应用自身鉴权后再暴露。
- [x] **Docker 本机运行边界已产品化。** `/api/docker/containers` 列表响应现在返回 `dockerScope`，明确该模块只操作 VControlHub 所在主机的 `/var/run/docker.sock`；`/docker` 页面在容器操作按钮之前展示“本机 Docker socket”警示，提示它不是跨 VPS 容器控制台，且 `docker:manage` 权限接近本机容器管理能力，避免用户把 Hub 主机 Docker 与远端 VPS 容器混淆。
- [ ] **Docker / QuickService / Direct Gateway 仍有部署边界需要说明和加固（P1）。** Docker 本机 socket 边界已在 `/docker` 页面和 API 元数据中显式展示；安装脚本会把应用运行用户加入 `docker` 组，拥有 `docker:manage` 的 Web 用户可间接操作本机 Docker，安全边界接近宿主机 root。QuickService 对远端应用源已限制宿主机挂载路径并默认禁止 Docker socket，但第三方模板仍属于供应链输入，且安装/更新还缺配置 diff、失败回滚和历史日志。Direct Gateway 默认生成 `http://host:31888` 明文直连链接并监听 `0.0.0.0`，签名能鉴权但不提供传输加密，需要反代 TLS/VPN/防火墙或改造默认部署。
- [ ] **公开状态与运行态展示仍可能过于乐观（P2）。** `/status` 已把启用 VPS/存储节点文案从“服务在线”改为“已启用/已配置，未做实时 SSH/SFTP/直连探测”，`/servers` 列表徽章也改为“启用 · 待探测”并在卡片层提示列表状态不代表实时在线，详情页可运行 SSH 只读实时探测；后续仍需把存储/直连入口接入 SFTP/Direct Gateway 专项探测。
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
- [ ] **前端可访问性、移动端和浏览器导航仍需系统化收口（P2）。** 全局搜索、Docker 日志、Docker 删除确认和 SSH 终端已具备统一 dialog focus 管理；文件浏览 SPA 已支持目录导航 pushState 与 popstate 恢复；SSH 终端已完成移动端纵向布局和响应式命令面板；文本预览搜索/跳转、文件浏览搜索、代码片段搜索、公告搜索、媒体库搜索、备份创建表单和快捷服务搜索已补可见 label，后续继续巡检其它 placeholder-only/低可见度控件。
- [x] **AI Provider 与应用源 URL 出网边界收紧。** AI Provider 的 `baseUrl` 和 QuickService 自定义应用源 URL 现在复用统一公网 HTTP(S) URL 校验，拒绝携带凭据、localhost、回环、内网、链路本地和常见 metadata 主机地址，并在创建/更新 Provider、创建应用源和服务端 fetch 应用源前二次拦截；默认 OpenAI Base URL 仍保持 `https://api.openai.com/v1`。后续仍建议用生产 egress policy / 代理 allowlist / DNS 解析与重定向复检继续防御 DNS rebinding 和重定向到私网。
- [x] **登录态 LOCAL/SFTP 下载流层已统一。** `/api/storage/local` 和 `/api/storage/sftp-download` 现在复用统一 Storage Stream helper 处理 Range 解析、`Accept-Ranges`、`Content-Range`、`Content-Length`、`Content-Disposition`、私有缓存头和 Node→Web stream 转换；SFTP 普通下载新增 `Range` / `206` / `416` 行为，远端流关闭或出错时会释放 SSH 连接，文件预览/大文件拖动不再因为登录态普通下载路径缺少 Range 语义而退化。
- [x] **公开目录分享已支持整体打包下载。** 公开分享页的目录卡片现在提供“下载整个目录”，调用 `/api/share/[token]?archive=1` 直接流式返回 `tar.gz`；公开 token 下载与登录态 `/api/storage/archive-download` 复用同一 Storage Archive helper 生成 LOCAL/SFTP tar.gz、中文文件名 `Content-Disposition` 和 SSH 流关闭逻辑，避免公开目录只能逐个文件下载。
- [x] **媒体库 stream 已迁入统一 Range/下载头 helper。** `/api/media/[id]/stream` 不再维护局部 `parseRange` / header 复制实现，LOCAL 和 SFTP 媒体流都复用 `parseStorageRange` 与 `storageStreamResponse`，统一 `Range` / `206` / `416`、`Accept-Ranges`、`Content-Range`、`Content-Length`、私有缓存头和 inline/attachment `Content-Disposition` 行为；测试覆盖本地媒体 Range、416 和下载头。
- [x] **文件列表预览入口已提前披露 Office/压缩包边界。** `/files` 的预览按钮不再统一只叫“预览”：Office 文件显示“打开 Office 下载提示”并在 title 说明不会公网在线渲染，压缩包显示“查看压缩包内容”并区分 LOCAL 可受控在线解压、SFTP 仅安全列表/下载；测试覆盖列表 action 的可访问名称和说明。
- [ ] **文件预览/分享仍有部分入口未完全闭环（P1/P2）。** 公开目录分享已支持整体 tar.gz 下载，登录态 LOCAL/SFTP 受控下载和媒体库 stream 已统一 Range/206/416 流层；Office 与压缩包边界已在列表入口提前披露，后续主要剩 README/API 文档补边界说明，或把压缩包受控解压扩展到更细的格式/权限/配额策略。
- [x] **备份创建表单已接入 Durable Job。** `/backups` 页面里的“创建并执行备份”表单不再通过 server action 直接调用 `deploy/backup.sh` 并占用请求；提交后会先创建 `PENDING` 备份记录，再排入 `backup.create` Durable Job，后台 `backup-job-worker` 负责执行、心跳和状态更新，页面文案也改为展示队列语义。生产 canary 已验证认证 POST 返回 `202 + jobId/taskId`，DB 中同时存在 `backup.create` Job 与 `PENDING` BackupRecord，随后清理 canary 记录。
- [x] **备份 Durable Job 英文文案已同步。** `/backups` 的 DOM i18n fallback 不再把创建备份翻译成“立即运行 deploy/backup.sh”；英文模式会显示“Create and queue backup”以及 Durable Job 后台队列/PENDING-RUNNING-COMPLETED-FAILED 刷新语义，避免中文页面已改队列但英文用户仍看到旧同步执行说明。
- [x] **存储节点元数据授权边界已收紧。** `/api/storage/nodes` 不再让只有 `storage:read` 的普通用户看到所有节点 `basePath` 和服务器绑定信息；拥有 `storage:manage-node` 的管理员/存储管理员仍可看全量节点，普通读者只返回其 `UserStorageAccess.canRead` grant 覆盖的节点，避免未授权目录结构和节点存在性泄露。
- [x] **文件回收站索引一致性已加固。** 普通删除现在先把 `FileEntry` 标记为回收站，再 best-effort 删除 LOCAL/SFTP 物理对象；如果物理删除失败，DB 不会继续显示为 active，页面会提示“索引仍可恢复或稍后重试永久删除”，并写入 `storage.file_delete_backing_failed` 审计。恢复入口改为调用服务层 `restoreFileEntry`，会先确认 LOCAL/SFTP 原始物理路径仍存在且类型匹配，避免只恢复 DB 标记。
- [ ] **文件状态一致性、远端索引刷新和存储列表性能仍需治理（P2）。** 删除/恢复主路径已避免“物理删了但 DB 仍 active”和“只恢复 DB 不确认物理对象”的高风险不一致；远端 SFTP 物理文件在 Hub 外被删除时，既有 `FileEntry` 仍可能保持 active，媒体流会安全返回 `No such file` 但需要后续专项刷新/校验任务把这类 stale inventory 标记清理；存储概览和文件列表仍有未分页 `findMany` 与内存聚合，大文件索引实例会有性能风险。
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
- [x] 文件管理资料流：`/files` 已补“资料详情”面板，把预览/编辑、下载、分享、媒体库搜索和管理动作集中到真实文件入口；后续继续把文件详情与媒体详情做更深的双向状态同步。
- [x] 媒体库可用性增强：媒体扫描会按真实文件扩展名补齐 `application/octet-stream` 的媒体 MIME，并在重新扫描时清理已删除/非文件条目的失效索引；扫描按钮会反馈更新/清理数量，媒体播放页已补同类型上一项/下一项导航、下载和回源入口。后续继续补更完整的标签批量管理体验。
- [ ] VPS 运维控制台增强：`/servers` 详情页已把 SSH、SFTP 存储绑定、Direct Gateway、待审批命令串成“诊断下一步”，并新增“运行实时探测”按钮，复用现有监控接口做 SSH 只读采样并展示成功/失败结果；后续继续补 Direct Gateway/SFTP 更细的一键修复建议和 Quick Apps 运行态联动。
- [x] **设置页运行参数反馈已产品化。** `/settings` 运行参数区现在为每个可调参数展示当前运行值、来源（数据库设置/环境变量/系统默认值/无效 DB 回退）、生效位置、环境变量名、范围和是否需要重启；管理员能在保存前判断改动是否已实际进入运行进程，避免只看到输入框却不知道当前值从哪里来。
- [ ] **设置页高风险设置回滚/审计仍需补齐（P2）。** 运行参数当前值、配置来源、生效位置和重启边界已展示；后续继续为高风险设置补变更审计、最近修改人/时间、回滚入口和风险确认。
- [ ] 备份策略管理：UI 化定时备份入口已完成，继续补后台任务化执行、异地备份、恢复验证、保留策略自动清理。
- [ ] 操作回滚：关键文件/配置/部署操作提供 undo 或恢复点。
- [ ] 仪表盘自定义：拖拽卡片、指标选择、时间范围筛选。
- [ ] 状态真实性：公开状态页已区分“已配置/已启用”和“未实时探测”，`/servers` 列表也已明确“启用 · 待探测”并把实时 SSH 探测放到详情页；继续让存储/直连入口接入 SFTP/Direct Gateway 专项探测。
- [ ] 可访问性收口：全局搜索、Docker 日志、Docker 删除确认、SSH 终端、文件/媒体/公告/代码片段搜索、文本预览搜索/跳转和备份创建表单已补关键 focus/label；继续巡检其它 placeholder-only、低可见度或移动端难操作控件。
- [ ] 移动端适配：底部导航已覆盖核心入口，后续补更多高频入口/溢出菜单；SSH 终端、Docker 日志、文件浏览等复杂面板需改为手机友好的纵向布局、触摸友好控件和危险操作二次确认。

### P3 — 长期愿景
- [ ] 自动化工作流（Playbook）：条件触发、告警联动、步骤编排。
- [ ] 命令/部署执行 durable worker：现有命令请求已支持后台执行、心跳、陈旧恢复、超时/输出限制、并发目标执行和审批中心取消入口；下一步把命令/部署最终执行迁入 DB-backed job worker，并补跨进程取消、按节点并发上限和可观测日志流。
- [ ] RBAC 角色视角巡检：为管理员、运维、只读用户提供可复用的页面按钮/API 权限一致性巡检，减少“按钮可见但点击 403”或“API 可调但页面没入口”的漂移。
- [ ] 站内 QA 报告产品化：把 canary/cron QA 结果、失败模块、修复建议、部署版本和最近 smoke evidence 展示到产品内，方便从 Web 端追踪质量状态。
- [ ] 多租户/团队空间：资源隔离、配额管理、权限继承。
- [ ] 成本追踪：VPS 费用、带宽/存储用量、月度报告。
- [ ] 智能运维 AI：主动诊断建议、异常预测、自动修复建议。
- [ ] PWA 离线支持和集成市场。

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
