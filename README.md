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
| `deploy.sh` | 修源 owner → 清 `.next` → 以 `vcontrolhub` 用户 build → chown `.next` → 重启服务 → smoke-test 一条龙（避免 root 跑 build 导致 service 启动失败） |

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
| API 端点 | 75（withApiRoute 全覆盖，7 个特殊路径合理豁免） |
| 数据模型 | 46 |
| UI 组件 | 27 |
| 代码行数 | ~79,700（src 扫描） |
| 测试 | 260 文件 / 1488 tests / 51.2% 覆盖 |
| Docker 应用模板 | 44 (本地) + 187 (社区) |

---

## 🔎 当前可用性与功能完整性状态（基线 2026-06-14，持续更新）

> 当前重点已经从"页面是否能打开"推进到"按钮是否真的有副作用、设置项是否真的生效、后台任务是否真的会跑、安装脚本是否能支撑 fresh install"。本节按主题分组，逐项交付摘要，便于快速判断功能闭环度。

### ✅ 已完成的关键闭环

**安装与部署**
- 一键安装脚本已增强：无域名走 Apache/IP 直连，`APP_SLUG` 支持短横线，PostgreSQL 用户/库名安全转换为下划线标识符，部署资产校验进入 `npm run verify`。
- `deploy/smoke-test.sh` 拆 `SMOKE_SCOPE=systemd|http`，Makefile 提供 `make smoke-systemd` / `make smoke-http`，适配外部数据库和自定义反代。

**前后端契约修复（早期 IDOR / 枚举 / 权限漂移）**
- 公告类型枚举统一为 `urgent`（前端发 `critical` 但 API 只接受 `urgent` 导致严重级公告无法创建）。
- 代码片段编辑/删除校验所有权（仅创建者或 `role:manage` 可改删，修复 IDOR）。
- `requireSession` 增 `mustChangePassword` 拦截，强制改密用户首次登录跳转改密页。
- 用户管理页创建/权限/禁用按钮按 `user:manage` 控制；命令模板列表 GET 权限改为 `command:read`。
- `/shares` 公开落地页只读预览不增计数，下载仍走 `/api/share/[token]` 计数端点。
- 工单更新支持状态/负责人/优先级一起更新（之前 UI 有字段但 API 丢弃）。
- 系统设置 (`session.timeout` / 密码复杂度) 真实约束普通登录 TTL、改密、创建用户和重置密码。

**后台 worker 真实运行**
- 定时任务 worker 随服务启动，按到期时间触发命令请求并记录运行结果。
- 告警评估 worker 已迁入 Durable Job：每轮去重排入/认领 `alert.evaluate` job，记录 heartbeat、失败重试、完成结果和 workerId；进程重启不会丢任务。

**文件 / 媒体 / 图床 融合**
- 文件管理"当前节点操作"闭环：新建文件夹和上传默认落到当前正在浏览的 LOCAL/SFTP 节点，操作成功自动刷新 SPA 列表。
- 公开目录分享支持整体 tar.gz 打包下载（`/api/share/[token]?archive=1`），与登录态归档复用同一 helper。
- 登录态 LOCAL/SFTP 下载流统一处理 Range / 206 / 416 / Accept-Ranges / Content-Range / Content-Disposition；远端流关闭释放 SSH。
- 媒体库 stream 已迁入统一 Range 头 helper，列表查询不再加载 SFTP 凭据，播放流授权后才加载，密码型 SFTP 媒体在生产 Range 请求中恢复 `206`。
- 媒体库 / 图床融合：`/media?type=image` 作为图片工作区，整合上传发布外链；`/image-bed` 改为外链管理/审计页，不再作为主导航并列入口。
- 媒体卡片直接显示图片缩略图、视频首帧、统一风格音频封面；图片/视频/音频一等类型切换保留筛选条件；类型计数全局统计。
- 图床删除授权收紧：`user:read`（默认 viewer 即拥有）不再被当作跨用户删除许可，单图删除需所有者/`storage:delete`/`role:manage`，批量删除需显式管理权限。
- 文件资料详情面板：列表、图标、详情视图统一展示存储节点/驱动/路径/大小/修改时间/访问方式，预览/编辑/下载/分享/重命名/移动/删除收束到同一入口。
- 文件列表高密度操作收口：行内保留资料详情/预览/下载为一级，分享/重命名/移动/删除收束到"更多操作"菜单；统一 toast/alert 反馈；媒体扫描自动补 octet-stream 真实 MIME。
- 在线文本编辑：`/files/preview` 对 LOCAL 可编辑文本展示编辑入口（512 KB 限），保存前显示差异预览，写入校验 DB updateAt 与磁盘 mtime，被并发改动会拒绝覆盖。
- 文件回收站索引一致性：先标记回收站再 best-effort 物理删除；物理失败 DB 不会显示 active；恢复入口确认 LOCAL/SFTP 物理路径仍存在且类型匹配。
- 文件浏览 SPA 已支持浏览器后退/前进：目录树/面包屑用 `pushState`，刷新/上传/搜索用 `replaceState`，`popstate` 重新拉取列表。

**下载 / 部署 / 备份 / 快捷服务**
- 下载中心批量语义补齐：HTTP/HTTPS 批量为每 URL 创建独立任务；磁力/BT 与普通 URL 混合时前端拦截；新建下载只展示已启用、已绑定存储且配置 SSH 凭据的可用 VPS；选择目标 VPS 即时显示直连/中转模式；已完成任务"下载文件"复用 `buildDirectAccessStrategy`。
- 部署真实回滚已落地：命令模板可配置独立 `rollbackCommand`，部署运行保存不可变 `DeploymentSnapshot`，`/deployments` "执行真实回滚"创建 `DeploymentRollbackRun` 并通过原审批/命令链路执行；"重新提交部署"仅作兼容标注。
- 备份链路完整化：备份记录展示 B/KB/MB/GB 自适应；策略概览展示完成/失败/执行中、已用空间、最大备份、>30 天保留提示、DATABASE/FILES/FULL 容量分类；备份创建已迁入 Durable Job (`backup.create`)；恢复 API 校验存在 + `RESTORE` 确认后排入 `backup.restore` worker；保留 `?wait=1` 同步路径作过渡；DOM i18n fallback 同步到队列语义；历史 PENDING/FAILED 记录有显式作废入口；FAILED 记录有重试入口（重新排队 durable job）；失败原因聚合按路径越界/权限/超时/缺失文件/存储写入/脚本执行归类并给出修复建议（如历史只读路径迁移到 `BACKUP_DIR` 或 `/var/backups/<slug>`）。
- 快捷服务一键更新：`docker pull` + 重建 `qs-*` 容器复用既有端口/挂载/环境/命令；状态机 `installing → running` 或写入可见错误；返回 health/status 与最近日志尾部，前端展示在成功提示里。
- 快捷服务卸载：默认仅删容器和 DB 记录，可勾选清理允许范围内的挂载目录；不会删 Docker socket、时区文件或根目录。
- 快捷服务生命周期已全部迁入 Durable Job（`quick_service.lifecycle`）：安装/启动/停止/状态刷新/更新/卸载只做权限/输入/端口校验后返回 `202 + jobId/taskId`；后台 worker claim/heartbeat/complete/fail 后再执行 Docker side effect；同一 slug 未完成任务会被复用而非重复入队；任务中心展示阶段进度（拉镜像/重建容器/健康检查/同步结果摘要）和 logPreview。
- 快捷服务安装/更新前展示非敏感配置预览（环境变量键数量、宿主机挂载、额外端口、公开端口风险），取消不触发 side effect；API 不再下发环境变量值。
- 快捷服务生命周期审计：`quick_service.*.started/succeeded/failed` 全覆盖，失败保留截断 Docker 错误摘要，`listQuickServiceHistory()` 取最新 50 条。

**告警 / 通知**
- 告警每条规则可触发测试发送，通知发送给具备 `notification:manage` 的管理员，Webhook 走安全测试请求并展示发送/跳过/失败结果，审计不记录 Webhook 密钥。
- 邮件告警通道接入 SMTP：设置页配置告警收件人，保存校验邮箱列表；告警测试和真实评估在选中 `email` 渠道时实际发送。
- 通知中心删除等行内操作不再 hover-only 死控件：移动端默认可见，桌面键盘聚焦显示，详情/已读/删除/全部已读补 focus-visible ring，浅色模式补未读状态色。

**任务中心可观测性**
- `/api/operation-tasks` 暴露 `taskType`，已完成 `alert.evaluate` 周期任务按类型折叠为最新代表记录（折叠 N 次完成记录），运行中/失败不被隐藏。
- 状态筛选（全部/需处理/失败/运行中/待处理/已完成）+ durable job `taskType` 筛选 + `sort=attention|recent` 排序偏好（`attention` 把失败/运行中/待处理置顶）。
- 按当前筛选返回 `sourceSummary`（命令/后台/下载/备份/部署来源汇总）和 `failureSummary`（按权限-认证/超时/资源-不存在/网络-连接/通知-发送/备份-恢复归类失败模式）。
- 任务最近日志摘要 `logPreview`：从 durable job 进度/错误、命令执行摘要、目标 stdout/stderr、下载/同步/备份路径提取最多 3 行上下文。
- `alert.evaluate` 完成历史保留策略：每次成功后裁剪 completed 历史只保留最新 25 条且不删 7 天内记录；运行中/待处理/失败/取消不受影响。
- `/operation-tasks` 当前结果导出 CSV（复用同 `task:read` 权限和筛选参数，安全转义）。

**安全收紧**
- 在线文本编辑权限边界：`/api/files/editable/[id]` 读取/保存把 session 传入存储服务，按 LOCAL 文件条目调用 `assertStorageAccess` 校验节点+相对路径，避免全局权限绕过细粒度路径授权。
- 远端文件代理：`/api/servers/[id]/file-proxy` 启动前确认服务器绑定 SFTP 节点，把 `SERVE_DIR` 限制到节点 `basePath`，目标主机内 realpath 边界校验；token 改 Authorization Bearer / X-VControlHub-Proxy-Token header（query token 仅作旧客户端兜底）；CORS 收紧到 Hub origin，补 `Referrer-Policy: no-referrer` / `nosniff`。
- 存储节点元数据授权边界：`/api/storage/nodes` 普通 `storage:read` 用户只看 `UserStorageAccess.canRead` 覆盖的节点（不再泄露所有节点 basePath 和服务器绑定）。
- AI Provider `baseUrl` 与 QuickService 自定义应用源 URL 复用统一公网 HTTP(S) URL 校验：拒绝携带凭据、localhost/回环/内网/链路本地/常见 metadata 主机；服务端 fetch 应用源前二次拦截。
- AI Hosted Tools 授权下沉到 `hosted-service`：自动批准的只读 SSH 工具必须携带 `server:ssh`；危险工具审批必须 `ai:action:approve` 且不允许自批；`/api/ai/hosted-actions/[id]` 由共享 API guard 强制权限。
- QuickService Docker 边界已显式化：`/docker` 页和 API 元数据返回 `dockerScope` 提示"本机 Docker socket"，`docker:manage` 权限接近本机 root；QuickService 访问 URL 标注"公开直连端口"或"反代 HTTPS"。

**Durable Job 底座**
- 新增 DB-backed `jobs` 表与 `JobStatus`：enqueue / lease claim / heartbeat / retry / fail / cancel / 陈旧 RUNNING 恢复 / progress / result / error；任务中心已统一聚合 durable job 与传统记录。
- 命令执行已迁入：后台 SSH 执行 + 心跳 + 陈旧 RUNNING 恢复 + 输出/超时 guardrail + 并发目标执行；`/requests` 审批中心提供"取消命令"入口（CSRF 保护，终止进程内 SSH 子进程或标记 CANCELLED）。
- 已纳入：备份创建/恢复、SFTP 同步、QuickService 生命周期、告警评估。

**前端 UI 统一化**
- `globals.css` S1-S12 语义化块（`data-card` / `data-variant=primary|secondary|ghost` / `data-empty-state` / `data-skeleton`）接管卡片/按钮/空状态/骨架屏，1500+ 处硬编码容器升级为 `data-card`。
- 冗余 `light:` 修饰符批量清理：`light:text-{slate|cyan}-9XX` 死代码 665 处、`light:text-{cyan|emerald|rose|amber}-{1XX..9XX}` 彩色 229 处（70 文件，computed color 零变化）、`light:bg-white` / `light:border-slate-200/300/400` / `light:text-slate-500..950` / `light:bg-slate-50/100/200/300` 共 431 处、`light:bg-slate-{50,100,200,300}` 58 处、`light:bg-slate-900/{20,30,50,60}` 模态遮罩 16 处、`light:bg-white/{40..95}` 弹层 78 处。`light:` 总数从 633 → 386 → 297（~53% 收敛）。Q 兼容层 R1-R7 + Q1-Q7 段已 100% 接管这些 dark 默认类在 light 模式的映射。
- 浅色模式代码/命令块统一为浅色中性 code surface（代码片段/应用部署/QuickService 安装提示/备份预览同类）；快捷服务卡片/应用源/弹窗补浅色边框和文本状态色。
- 页面标题 `PageHeader` 统一 18+ 页 (announcements / operation-tasks / shares / tickets / deployments / backups / health / quick-services / api-tokens / docker / traffic / preferences / monitoring / api-docs / image-bed / media)：eyebrow 用 `text-[var(--accent)]` + `data-page-eyebrow` 标记，H1 统一 `text-3xl font-semibold text-[var(--text-primary)]`；新增 `html[data-locale="en"] [data-page-eyebrow]{display:none}` 让装饰性英文 eyebrow 在英文模式自动隐藏。
- 空态 / 加载态 / 工具栏统一：`<EmptyState>` 扩展 `children + text` + `variant: simple|boxed`，跨 16 页面迁移 22+ 处手写空态 + 6 处手写加载态。
- 骨架屏 token 化：S12 shimmer 中点改 `color-mix(--text-muted 22%, --surface)`，浅色也有可见 shimmer；20 个 `loading.tsx` 通过中央 `PageSkeleton` 自动受益。
- `<ToggleChip>` 原语：双色 (accent/warn) + `aria-pressed`/`aria-label`，image-bed 切换迁移到此。
- `data-tone` 状态色统一：badge / alert / 卡片大批量替换硬编码状态色（21 处 + 6 处 + 142 处 = 169 处，跨 R-轮）。

**状态页 / 公开数据**
- `/status` 与 `/api/status` 不再按"已配置存储节点数量"给乐观结论，改汇总最近存储节点健康探测的健康/异常/待探测；公开输出仍不暴露 SFTP/Direct Gateway 主机/端口/路径/凭据；`/files` 存储节点"立即检测"作为写入公开摘要的专项探测入口。

**a11y 收口（跨多 R 轮）**

下列入口都补齐了显式 `htmlFor`/`id` 标签关联、可见可访问名称、合适的 ARIA 语义和回归测试，避免 placeholder-only 或 hover-only 死控件：

- 弹窗：Docker 日志、Docker 删除确认、SSH 终端弹窗（统一 `useDialogFocus` hook：初始聚焦/Escape/Tab 循环/恢复焦点）、全局改密弹窗（`role="dialog"` + 三密码输入复用显隐 + status/alert 反馈）。
- SSH 终端 mobile：弹窗改可滚动纵向布局，命令面板从固定右侧栏改 mobile 全宽堆叠，画布高度 `clamp(320px,58vh,560px)`。
- 搜索框可见 label：文件浏览 / 文本预览搜索+跳转 / 代码片段 / 公告 / 媒体库 / 快捷服务 / 图床兼容页 / 文件存储节点筛选。
- 表单可见 label：备份创建 / 备份恢复确认（"输入 RESTORE 确认恢复"）/ 命令模板创建+下发 / 快捷服务搜索 / 添加 VPS 连接方式（fieldset+legend）/ 公告发布 / 定时任务创建 / 文件创建文件夹 / AI 对话重命名 / 2FA 启用关闭验证码 / 下载创建链接。
- 全局搜索：认证侧栏新增可见"全局搜索"按钮（不只依赖快捷键），弹窗记录触发按钮并在 Escape/遮罩关闭后恢复焦点。
- 反馈语义：备份重试排队成功用 `role="status"`，失败用 `role="alert"`，并保留任务中心链接。
- 全局搜索目录由侧边栏与系统导航统一生成，明确排除 `/system-health` `/quickservice` `/backup` `/ssh` 等旧路径；改密和 2FA 入口改 `/settings#password` `/settings#2fa`，不派发不存在事件。
- 下载任务记录删除回归测试：`/api/downloads?purge=1` 终态任务只删历史行不触碰远端进程；运行中先要求取消。

### 🟡 仍在进行的边界 / 已知非阻塞缺口

> 这些条目主体已落地，描述里的"继续补"是后续增强，不影响当前可用性。

- Direct Gateway TLS 加固：Python 服务默认绑定 `127.0.0.1`（`DIRECT_GATEWAY_BIND_DEFAULT`，需显式 opt-in 才能监听 `0.0.0.0`），systemd unit 显式声明 `Environment=DIRECT_BIND=…` 便于 `systemctl show` 审计；`getDirectGatewayRiskAssessment()` 在 `bind=0.0.0.0 + http 明文` 时返 `level: "danger"` + 4 条修复建议（Caddy 反代 / VPN / 防火墙白名单 / 改回 127.0.0.1）；`deploy.sh` step 2.6 启动时**自动 patch `/etc/caddy/Caddyfile`** 加 `reverse_proxy /direct 127.0.0.1:31888` 段（idempotent，缺则注入，注入前备份 `.bak.YYYYMMDDHHMMSS`，注入后 `caddy validate` 验证语法再 reload，失败自动回滚），本机 SFTP 节点走 Caddy 出站 HTTPS；`getDirectGatewayRiskAssessment()` + `buildDirectGatewayPublicBaseUrl` 加 `protocol` 参数支持 https 拼接。剩余：UI 加风险 banner + 跨 worker lease 公式统一（见 New-E / TR-043）。
- **后台任务业务迁移与并发控制（TR-001, P1）** — Durable Job 底座已承接 SFTP 同步、备份创建/恢复、告警评估、QuickService 生命周期、命令执行、定时任务调度（`scheduled-task.tick` durable job + claim/heartbeat/complete 路径，与 `alert.evaluate` 同范式），并补齐下载 direct/relay 路径（`download.execute` job）。并发控制已加全局/按用户/按节点三道软上限（`JOB_MAX_CONCURRENT_GLOBAL` / `_PER_USER` / `_PER_NODE`，默认 0=不限制），`Job.targetStorageNodeId` 列 + `@@index([targetStorageNodeId, status])` 索引承载按节点计数。剩余：可观测日志流（`JobEvent` 表 + 5 个 worker 钩子已落，详情见 commit `4e6a0ed`）；生产级 worker 部署策略（vcontrolhub-worker systemd 拆分）。
- **前端 a11y / 移动端 / 浏览器导航系统化收口（TR-003, P2）** — 主体已完成（统一 dialog 语义、focus 管理、SPA pushState/popstate、SSH 终端 mobile、跨入口可见 label/语义分组）；TR-021 第一阶段 (231 form field label 关联) 已 100% 覆盖；**TR-003 续作 (Phase 2 icon-only button detection) 已落地**（scripts/accessibility-audit.ts 新增 `scanIconOnlyButtons` 范式，254 文件扫出 32 个 icon-only `<button>` 缺 `aria-label`/`title`，已修 3 个最关键 (AI 聊天页发送按钮 + 侧边栏 mobile 切换)，剩余 29 个为 advisory 巡检项需逐文件人工 review 是否真为 icon-only（许多实际含 `{variable}` 引用文本但静态分析保守标记）。Phase 2 测试 12 条覆盖 `aria-label` / `aria-labelledby` / `title` / 变量引用 / 三元 literal / multi-line 行号等 6 类边界。
- **文件预览 / 分享边界文档化（TR-004, P1/P2）** — 公开目录 tar.gz、统一 Range/206/416、Office+压缩包入口边界已落地；**TR-004 文档化收口**：`docs/file-preview-sharing.md`（约 335 行）覆盖 12 节：接口清单 / Range 200/206/416 三态语义 / 公开分享 token / 归档下载 / 压缩包查看 / 在线解压（zip/tar 拒绝 + .gz 唯一支持 + 原子性回滚）/ Office 预览（不接 Office Online 的安全决策）/ Media 预览 / 已知限制 / 故障排查 / 代码位置索引 / 变更历史。范围：8 个 route + 6 个 client + 2 个 service + 1 个 streaming helper。剩余：扩展压缩包受控解压到更细的格式/权限/配额策略。
- **文件状态一致性 / 远端索引刷新 / 存储列表性能（TR-005, P2）** — 删除/恢复主路径已避免高风险不一致；**远端 SFTP 索引定期校验（TR-005 T34a）已落地**：`storage.sftp-stale-inventory` durable job (30min interval) + 全树 SFTP 列表 + DB diff + soft-delete + POST `/api/storage/sftp-stale-inventory` 接口 (队列 202 + `?wait=1` 同步);WorkerId `sftp-stale-inventory` 加入 `lib/workers/registry.ts` 第 9 个 worker + 5min lease preset + `/api/admin/workers` 健康检查可见。剩余：T34b 存储分页 + 内存聚合改造。
- **任务中心跨来源归档 / 长期保留（TR-006, P2）** — 已完成同类高频折叠、状态/类型筛选、聚合计数、失败归类、需处理排序、最近日志摘要、CSV 导出、`alert.evaluate` 历史保留策略、跨 5 来源 (command/download/sync/backup/deployment) 统一长期保留策略（`operation-task.retention` 6h durable job，默认 90 天 / 100 条，跳过 scheduled 和 job 来源）；无剩余子项。
- **备份运维（TR-007, P2）** — 作废入口、durable job 重试、status/alert 反馈、失败原因归类+修复建议已落地；剩余：异地备份 / 自动恢复演练 / 保留策略自动清理。
- **设置页高风险设置（TR-014, P2）** — 当前值/配置来源/生效位置/重启边界、最近修改人+时间已展示；M01 完成：字段级 ↺ 恢复默认按钮（高/中风险 badge）+ Save 角标 "X 项已修改"（含 diff 表）+ high 风险提交时弹确认 modal；M02 完成：高风险字段失焦且已变时 inline 警告条 ⚠ 提示保存前请确认影响（rose 色 + `role="alert"` 同步屏幕阅读器 + `aria-describedby` 关联 + 继续改值/保存后自动清除）。**2026-06-15 M01 决策落档**（用户拍板）：Q1 高风险文案 = 现状通用不吓用户 / Q2 二次确认 = 仅 high 弹模态 / Q3 未标 high 字段（SMTP 凭据 / AI provider 切换 / OCI 凭据 / SSH 密钥）= 暂缓 / Q4 high 字段保存后通知 = 不通知任何人。17 个字段风险等级在 `src/app/settings/field-schema.ts`（password 强保活 + 命令超时/卡死判定 + SMTP/2FA 开关 = high；密码规则 + runtime 调参 + 列表上限 = medium；其余 = low 不显示 badge）。
- **在线文件编辑器（TR-012, P2）** — 本机文本编辑/保存/权限/差异预览/并发修改检测 + SFTP 编辑（T17a） + 保存后重载服务（T17b）已全部落地；无剩余子项。

### 既知增强项队列

- 备份策略：异地备份、自动恢复演练、保留策略自动清理（TR-009/TR-015）
- 在线编辑：保存后重载服务、SFTP 编辑（TR-012）
- 媒体库 / 图床：图片目录批量选择、更完整的相册/标签管理
- 告警通道：Telegram、失败重试、发送历史趋势

---

## 🛠️ 维护批次摘要

### 移动端适配（TR-022，R7-R12 共 9 轮）

按 iOS HIG 44px 触摸标准（`min-h-11` `min-w-11`，Tailwind 4 默认 spacing 11 = 2.75rem = 44px 真实生效）+ mobile bottom sheet 模式：

| 轮 | 范围 | 重点 |
| --- | --- | --- |
| R7 | image-bed | 批量栏 sticky bottom + 桌面端复位；4 按钮+搜索 `min-h-11`；3 a11y 标记 |
| R8 | health-dashboard | header 堆叠避免 375px 溢出；修复建议 1/2/3 列响应；SummaryCard 字号响应；toggle `min-h-11 min-w-11` |
| R9 | docker | 头部 + 容器 10 按钮 `min-h-11`；删除确认 + 容器日志弹窗改 mobile bottom sheet（`items-end` / `mx-0 rounded-t-2xl` / footer `flex-col-reverse`） |
| R10 | 危险操作弹窗 | 备份恢复 + 快捷服务卸载/删除应用源/安装更新预览 4 个弹窗扩展 R9 mobile bottom sheet 模式 |
| R11 | ssh-terminal | 头部 3 按钮 `min-h-11 min-w-11`；侧栏 ✕ 删除按钮去 hover-only `opacity-0` 触屏可见；命令历史/快捷命令 `min-h-11` + 字号提升 |
| R12 | files SPA | mobile-only 顶部 toggle "展开/收起目录树"（aria-expanded + aria-controls）；sidebar `block`/`hidden xl:block` 条件；树导航后自动收起 |
| R17-R19 | 低频页面续做 | scheduled-tasks / snippets / templates / shares 共 27 按钮 `min-h-11` |

R7-R12 累计：~+692/−115 行（8 业务 + 6 测试），新增 21 测，1132/1132 测过；浏览器 light 模式 vision 复验 + DOM 探针全部命中。

> R8 触摸目标曾被误诊为"min-h-11 没生成 CSS"，实测 `.next/static/chunks/*.css` 中 `.min-h-11` 22 处规则真实生效；后续 cron 验证用 `getBoundingClientRect().height >= 44` 真实尺寸断言而不只是 className 包含。

### 架构提升 R18-R22（god-file barrel 拆解 + 零测试域补测）

| R | 对象 | 行数变化 | 子模块 | Commit |
| --- | --- | --- | --- | --- |
| R18 | `lib/storage/service.ts` | 1099→56 (-95%) | service-nodes / service-entries / service-overview / service-editable / service-direct-access | `7dbf642` |
| R19 | `lib/server/service.ts` | 985→46 (-95%) | service-internals / service-direct-gateway / service-profiles / service-ssh-keys | `b0c229a` |
| R20 | `lib/command/service.ts` | 880→29 (-97%) | service-execution / service-recovery / service-requests | `28bdcc5` |
| R21 | `app/files/file-list-client.tsx` | 1646→1592 (-90 行内联状态) | 抽 `use-file-toast` + `use-file-selection` 两 hook | `4ee8ba4` |
| R22 | 7 个零测试 lib 域 | 测例 +61 | datetime 9 / crypto 10 / a11y 6 / theme 8 / snippet 16 / image 6 / ws 6 | `727fcda` |

后续 R28.D 续作：`quick-service` (663→44) / `ai` (631→3 文件) / `sync` (435→4) / `backup` (382→5) / `health` (372→4)。8 个 god-file 全部 < 60 行 barrel，调用方零改动。

**R23-R28.A 续作**（更细 hook 抽取与 `noUncheckedIndexedAccess` 启用）：
- R23 `quick-services-client` 抽 `useQuickServiceActions` (1184→1055)
- R24 `ai-client` 抽 `useConversations` (1085→1069)
- R25 `files` 抽 `useFileBrowserListing` (967→837)
- R28.A.1+A.2 启用 `noUncheckedIndexedAccess`，分两阶段修 252+242 = 494 个错误（top 12 文件 + 余 242）

### R26 — 12 维度审计 + 死代码清理（2026-06-14）

应用户"项目越来越臃肿"指示，**未动业务代码**，仅删死代码 + 调测速 + 加 deploy 缓存清理。

| # | 维度 | 结论 |
| --- | --- | --- |
| 1 | 依赖 | 21 prod + 21 dev, 0 unused (redis/@xterm 是 dynamic import)。npm audit 7 vuln |
| 2 | 源码 | 101K 行 / 495 源 / 252 测试 (50.9% 覆盖)。TODO/FIXME 0。`@ts-ignore` 0 |
| 3 | 配置 | 3 env 文件字段一致，`.gitignore` 覆盖完整 |
| 4 | 安全 | eval 0、innerHTML 1、dangerouslySetInnerHTML 2 (经 DOMPurify)、child_process 0 |
| 5 | 性能 | await 3278、Promise.all 49、useCallback 132 |
| 6 | 路由 | 39 page + 79 route + 1 layout = 119；top: downloads 855 / ai/chat 578 |
| 7 | 客户端组件 | 142 'use client' / 301 .tsx = 47% (server-first + 选择性 client) |
| 8 | Prisma | 46 models, 4 @@unique, 58 @@index, 0 $queryRaw（无 SQL 注入面） |
| 9 | 测试 | 1413/1413 pass / 141s 单跑 / 196s verify 全流程 |
| 10 | TS 严格度 | strict: true ✓；`noUncheckedIndexedAccess` 已开（R28.A 落地）；`exactOptionalPropertyTypes` 仍关 |
| 11 | 构建 | dist 196K (gitignored)，`.next/cache/webpack` 429M (deploy 后清) |
| 12 | 死代码 | 2 真孤儿 + 16 debug 脚本（清理） |

清理动作：
- 删 `lib/auth/require-api-session.ts` (12 行，与 `api-session.ts` 100% 重复，0 引用)
- 删 `lib/files/sftp.ts` + 测试 (167+78 行，7 导出 0 生产引用)
- 删 16 个 5/28 incident 临时脚本 + 一次性 fix/迁移工具（scripts/ 22→6 文件）
- `deploy.sh [7/7]` 部署后 `rm -rf .next/cache/webpack` 回收 429M（保留 12K swc cache 加快下次 build）
- 周清 cron `0 3 * * 0`，日志 `/var/log/vcontrolhub-cleanup.log`
- vitest 改 `pool: "threads"`, `maxWorkers: 4`：161s → 141s（12% 加速）
- `ssh-terminal-modal.test.tsx` flake：`getByRole` → `findByRole` + `await`（条件渲染重连按钮）

误判记录（已恢复）：
- `@types/nodemailer` 误删 → typecheck 报 TS7016 → `npm i --save-dev` 恢复（`lib/notification/email.ts` 真用 nodemailer runtime）
- `redis` 和 `@xterm/*` 初看 0 import 误标 unused → 实际是 `await import(...)` dynamic（`lib/rate-limit-store.ts` / `components/ssh-terminal-modal.tsx`）

净行数：-1418（1448 deletions - 30 insertions）；commit `8768eaf`。

### R27 — 6 项 deferred 收尾（2026-06-14）

应用户"这些一轮能都做完吗"指示。

| # | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | lucide-react tree-shake | ✅ | `next.config.ts` 加 `experimental.optimizePackageImports: ["lucide-react"]`；5 处 import 已 named syntax；22 个唯一图标，39M → ESM < 1MB |
| 2 | npm audit 修复 | ⚠️ 1/7 | `esbuild 0.27→0.28` (修 1 high: Deno RCE)；6 moderate (hono / prisma 5 / next 9 / @hono/node-server) 全部需 major bump 等上游 |
| 3 | innerHTML / dangerouslySetInnerHTML 业务审计 | ✅ 0 风险 | jsdom test cleanup 1 处；markdown-preview / text-preview 2 处经 DOMPurify 严格白名单 (19 tag + 4 attr，`ALLOW_DATA_ATTR: false`)，无 XSS 路径 |
| 4 | 业务 `any` 细化 | ✅ 0 残留 | `rate-limit-store` 抽 `RedisClientLike` interface + `RedisExecResult` 数组类型；`http/api-guard` 把 `(err as any).issues` 改为 typed `rawIssues: ReadonlyArray<{ path?: unknown; message?: unknown }>` |
| 5 | `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` | ✅ noUncheckedIndexedAccess 已开 (R28.A 落地 494 errors) | R28.A.1+A.2 拆 2 轮修完 (commit `14fce8d` + `f73730c`)；`exactOptionalPropertyTypes` 仍关（需 wrapper 改 ~200 Prisma caller，ROI 不划算） |
| 6 | sibling in-flight | ⏸️ 等待 | media thumbnail / remote-traffic sibling PR 收尾中 |

Top 10 严格度错误文件（供 R28.B 参考）：`markdown-preview-client` (34) / `ai-markdown-renderer` (21) / `lib/security/webhook-url` (20) / `settings-client` (19) / `direct-gateway-advice.test` (18) / `health-dashboard-client` (17) / `lib/downloads/source-url` (16) / `file-list-client` (13) / `lib/server/monitor` (12) / `app/api/files/archive-list/route` (12)。

R27 验证：254 / 1413 测过，verify 4:30，smoke 25/25；commit `6fac482`；5 files +192 / -645（package-lock 重组占大头）。

### 双 AI 协作的 Git 协作模式（2026-06-13/14）

24h 内 5 个作者身份（VControlHub Maintainer / VControlHub TR-advancer / Hermes / tr-advancer / TR-advancer cron）共 74 次提交，全部线性、无 merge、无 force-push、无 conflict 标记。两个 session 接力修同一仓库的安全约束：

1. push 前 `git pull --rebase --autostash`
2. 不 force-push（GitHub 默认 `denyNonFastForwards`）
3. reflog 里 `reset: moving to HEAD` 是 no-op，不会丢提交

---

## 🔬 全量代码审查（2026-06-13）

**审查范围**：64k 行 TS/TSX 源码（不含测试）、450 源文件、236 测试文件、79 API route、39 页面路由、40 业务模块。
**审查方法**：静态信号扫描 + 关键文件抽样 + 与 README TR 描述对账。**未改动一行业务代码**，仅产出问题清单。

### 现状评估（结构上比预期好）

- **零循环依赖**（lib/* 跨域引用全是单向）；db/logging/auth 是合理基础设施层（被 29/13/6 模块依赖）。
- **鉴权架构清晰**：`proxy.ts` middleware 边界守门 + `withApiRoute({ permission })` 细粒度，79 route 全覆盖（7 不走该 helper 的均合理：login / image-public / status / share-token / 2FA / dashboard-self-guard / openapi-reexport）。
- **`'use client'` 文件未直接 import 服务端 prisma**，仅 3 处 `import type` 跨边界（type-only，bundle 0 影响）。
- **页面 loading.tsx / error.tsx 覆盖率 32/39 ≈ 82%**，next.js convention 落实较好。
- **测试覆盖**：236 测试文件（约 1:1.9 测代比），命令/job/sftp 等高风险模块有专门 worker.test。

### 现有 TR 核实结果

按"复选框语义与代码事实是否吻合"重新分类：
- **真已完成** TR-001 / TR-002 / TR-004 / TR-005 / TR-006 / TR-008 / TR-010 / TR-011 / TR-012 / TR-013 / TR-014 / TR-015 / TR-019 / TR-020 / TR-021 / TR-022 / TR-025 / TR-029 / TR-034 / TR-035 / TR-036 / TR-037 / TR-038 / TR-039 / TR-040 / TR-041 / TR-042 / TR-047 / TR-048 / TR-049 / TR-050 / TR-051 / TR-052 / TR-053 / TR-054
- **主体已落地、复选框未收口**（描述写"已完成主体/继续补"，状态符号仍 [ ]）：TR-007 / TR-023 / TR-031 / TR-032 / TR-033
- **巡检工具已落地、剩余为 advisory 巡检项**（TR-003）：静态分析覆盖,剩余需人工 review。
- **真未启动**：TR-009 / TR-016 / TR-017 / TR-018 / TR-024 / TR-026 / TR-027 / TR-028 / TR-030

### 新发现问题 TR-034 ~ TR-042

#### TR-034 P1 — API 错误响应 shape 不统一

69 route 共 235 处 `NextResponse.json({ error: "..." }, { status })` 仅有文案、没有 `code`，前端无法 i18n / 类型化处理。建议引入 `ApiErrorBody = { code; message; details? }` + `errorCodes.ts` (`AUTH_REQUIRED`/`VALIDATION_FAILED`/`FORBIDDEN`/`NOT_FOUND`/`RATE_LIMITED`)，codemod 替换为 `apiError("CODE", message, details, status)`，前端 `lib/http/api-client.ts` 按 `code` 分发。

#### TR-035 P2 — 环境变量集中读取层

29 文件直接 `process.env.XXX` 散布在 `app/`、`lib/`、`ssh-ws-proxy.ts`、`instrumentation.ts`、`proxy.ts`。风险：默认值不一致 (`SSH_WS_MAX_CONNECTIONS || "50"`)、缺失校验、改名要全文搜。建议扩 `lib/server/config.ts`，按命名空间暴露 `config.ssh.maxConnections` / `config.auth.sessionSecret`，仅 `config.ts` / `db.ts` / `proxy.ts` 三处启动入口保留 `process.env`。

#### TR-036 P1 — 大客户端 bundle 拆分

| client 文件 | 行数 |
| --- | --- |
| `app/files/file-list-client.tsx` | 1245 (T36b 后, 1604→1245) |
| `app/ai/ai-client.tsx` | 1011 (T36c 后, 1085→987) |
| `app/files/files-browser-spa.tsx` | 967 |
| `app/quick-services/quick-services-client.tsx` | 587 (T37 后, 1002→574) |
| `app/health/health-dashboard-client.tsx` | 745 |
| `app/image-bed/image-bed-page-client.tsx` | 695 |
| `app/files/preview/text-preview-client.tsx` | 619 |
| `app/downloads/downloads-client.tsx` | 569 |
| `app/servers/server-overview-card.tsx` | 522 |

建议：每个 ≥500 行 client 拆 `*-table.tsx` / `*-toolbar.tsx` / `*-dialog.tsx`，配 `next/dynamic` 懒加载对话框/抽屉/编辑器。与 TR-017 同方向延续。

#### TR-037 P2 — API 入参 zod 校验补齐

R1-R5 累计 17 路由, R6 (T38b) 走 storage 域 8 路由 (archive-download / direct-access / local / sftp / sftp-download / sftp-ops / sftp-stale-inventory / sftp-sync) 共用 `src/lib/storage/schema.ts` (10 个新共享 schema + 5 type export, 17 新 schema 单测), storage 域覆盖率 0% → 100%, 总体 13% → 47.8% (11/23 routes)。剩 12 路由待 R7+ (ai 域 7 / files 域 3 / command 域 1 / 其它 1)。

#### TR-038 P2 — God-object service 继续拆分

`lib/server/service.ts` 1120 / `storage` 1099 / `command` 880 / `quick-service` 663 / `ai` 631 / `sync` 435 / `backup` 382 / `health` 372。TR-019 R10~R14 抽 adapter (ssh-executor / docker-cli / provider-http / command-runner) 已做，但只触及 adapter 层；建议 service 内部按"对象-动词"分子模块（`server/service.ts` → `crud` / `monitoring` / `direct-gateway` / `diagnostics`），单文件 < 400 行。R18-R22 + R28.D 已实施大部分。

#### TR-039 P2 — 领域 DTO 边界续做

5 个域仍把类型从 `service.ts` 直接给 client：`lib/operation-task/`（service 14 处 include，复杂关联）/ `runtime-settings` / `files` / `ai` / `deployment`。已完成样板：`lib/settings/schema.ts` / `lib/backup/schema.ts` / `lib/storage/schema.ts` / `lib/quick-service/types.ts` / `lib/command/schema.ts`。续作此 5 个即全域 DTO 闭环。

#### TR-040 P2 — N+1 查询审计与修复

候选 3 文件：`lib/command/service.ts` / `lib/command-template/service.ts` / `lib/quick-service/app-source-sync.ts`，均存在 `for (const x of list) { await prisma.* }`。建议替换为 `findMany({ where: { id: { in: ids } } })` + 内存 join 或 `Promise.all`（无序约束时）。影响：列表页 TTI 与后台 worker 吞吐。

#### TR-041 P2 — 自定义错误类

273 处 `throw new Error("文案")` 分布 61 文件，类型上都是 `Error` 一种，调用方只能 `instanceof Error` + 字符串匹配。建议 `lib/errors.ts` 引入 `AppError`（带 `code: string`）+ 子类（`AuthError` / `NotFoundError` / `ValidationError` / `BusinessError`），配合 TR-034 在 `apiCatch` 按错误类型映射 HTTP 状态。

#### TR-042 P3 — i18n 文案覆盖度

`translations.ts` 380 行 + `dom-translations.ts` 通过 DOM 替换；`use-locale.ts` 提供 `useI18n()` hook，架构合理。隐患：`translations.ts` 是有限白名单，新页面/新文案极易遗漏。建议 `scripts/i18n-coverage.ts` 扫 `app/**/*.tsx` 中可见用户文案（中文字面量 outside `data-i18n` / 注释），与 keys 比对，CI 报缺失。

### 优先级与下一步建议

按用户 priority（功能完整性 > 可用性 > 性能）映射：
- **功能完整性** → TR-001 / 002 / 004 / 011 / 015 / 023
- **可用性** → TR-026 / 014 / 016 / 029 / 034
- **性能** → TR-036 / 040 / 005

**不建议本轮立刻动**：TR-024（durable worker 全量迁移）、TR-030（多租户）、TR-032（智能运维 AI），三者都是大改造，需先单独方案评审。

### 2026-06-15 第二轮审查新发现（worker 真假并存，未并入 TR 编号）

由其他 AI + 主会话双重人工复核得出的高/中风险。前 4 项为**当前生产可能产生副作用**的真问题，必须人工在场修复（不交给后台 cron）；后 3 项是已落地的同类增强建议，可作为独立 TR 起案。

#### New-A（高）下载入队失败被吞，下载任务永远 PENDING

`src/app/api/downloads/route.ts` 创建 `downloadTask` 成功后，用 `void enqueueDownloadExecutionJob(...).catch(logError)` 异步 fire-and-forget 入队；若 `jobs` 表短暂抖动 / Prisma 短暂失败，下载 API 仍 `success: true`，留下永远 `PENDING` 且无 durable job 的任务。修复思路：route 端先 `await enqueueDownloadExecutionJob(...)` 再返回 201，并把入队失败回滚为 `downloadTask.status = FAILED` + 业务级 errorMessage；durable worker 启动入口对应改成"幂等 claim"（按 `downloadTask.status` 决定是否派发）。配套测试：mock `enqueueDownloadExecutionJob` 抛错 → API 返回 5xx 且 `downloadTask.status === "FAILED"`。

#### New-B（高，多进程部署才暴露）定时任务 tick 竞态 → 同一任务重复触发

`src/lib/scheduled-task/worker.ts:49` "查 active job 再 enqueue" 是非原子 read-then-write；多进程/cluster 模式下两台 worker 同时跑会都查到"无 active"，都 enqueue 多个 `scheduled-task.tick`，进而对同一到期 `ScheduledTask` 各创建一次 `CommandRequest`。
- **当前部署**：单进程 `tsx src/server.ts` + `state.running` guard，单点下不会触发，但**单点故障**：systemd 短暂重叠启动 / 未来加 `node:cluster` 都会暴露。
- **修复**：`enqueueScheduledTaskTickJob` 改 Prisma `$transaction` + 唯一约束（或利用 `(type, status) IN (PENDING, RUNNING)` 上的 `@@index` 改 `INSERT ... WHERE NOT EXISTS`），或换成 `prisma.job.upsert` with `where: { type_status: ... }` 复合唯一键。
- **配套**：`dispatchDueTask` 入队前用 `updateMany({ where: { id, status: "ACTIVE", nextRunAt: oldNext }, data: { nextRunAt: newNext } })` 行级 CAS，确保只有一份 worker 真正派发。

#### New-C（中）下载 durable worker 与 `downloadTask.status` 错位

`src/lib/downloads/execution-worker.ts` 调 `executeAria2RelayDownload` / `executeDirectDownload` 后无脑 `completeJob`，但这俩函数在 `src/lib/downloads/execution.ts:120/134` 等多处把 `downloadTask.status = FAILED` 后正常 return，**不抛错**；于是出现 operation-tasks 显示 job 成功，但 `/downloads` 业务行显示 FAILED 的状态错位。修复：worker dispatch 完后 `prisma.downloadTask.findUnique` 查一次最终 `status`，若 `FAILED` / `CANCELLED` 走 `failJob` 而非 `completeJob`；若 `COMPLETED` 走 `completeJob`；若仍 `RUNNING` / `PENDING`（中转 aria2 的常态）则**保持 RUNNING 不 completeJob**，让后续 `pruneCompletedJobsByType` / 终态路由推进。

#### New-D（中）`instrumentation.ts` 启动路径不全

`src/instrumentation.ts:5-10` 只在 `VCONTROLHUB_START_COMMAND_WORKER_IN_NEXT=true` 时启动 command maintenance/execution；`scheduled-task.tick` / `download.execute` 等只在 `src/server.ts:40-47` 启动。当前 deploy 走 custom server 没暴露，但只要未来有人 `next start`（不带 custom server）部署，下载/定时任务 worker 全停。
- **修法 A（推荐）**：把全部 worker 启动迁到 `instrumentation.ts`，由单一路径保证。
- **修法 B**：在 `deploy.sh` 显式检测 `tsx src/server.ts` 是否在跑，没跑就 `journalctl` 强告警。

#### New-E（P1 增强）Direct Gateway TLS / 防火墙默认边界 + 跨 worker 并发上限与 lease 策略

- Direct Gateway TLS 加固（TR-002 R1+R1.5+R2+R3 落地）：Python 服务默认绑定 `127.0.0.1`（`DIRECT_GATEWAY_BIND_DEFAULT`），显式 `DIRECT_BIND=0.0.0.0` 才监听全部接口；systemd unit 显式 `Environment=DIRECT_BIND=…` 便于 `systemctl show` 审计；`getDirectGatewayRiskAssessment()` 在 `bind=0.0.0.0 + http 明文` 时返 `level: "danger"` + 4 条修复建议；`deploy.sh` 自动 patch 生产 `/etc/caddy/Caddyfile` 注入 `/direct` 反代段（R1.5，模板不动）+ `caddy validate` 强校验（`ab258b6`）；7 个 worker 接入统一 lease 公式 `max(preset, 2× observedMaxDispatchMs) × 1.1`（R2，新增 `src/lib/job/lease.ts` + 6 test，7 worker 替换硬编码 `*_LEASE_MS`）；`/servers` 详情 UI 接收 `bindAddress` + `publicProtocol` 投影（R3），在直连已就位时输出 3 级（emerald=安全 / amber=警告 / rose=危险）risk banner，新增 `getResolvedDirectGatewayProtocol()` 解析 publicUrl scheme（+5 test）。**剩余**：`/api/status` 启动期公网暴露探测、强制 `recordJobEvent`（R4/R5）。
- 当前 8 个 worker 各自 `setInterval` 互不知情；已加：全局/按用户/按节点三道软上限（`JOB_MAX_CONCURRENT_*`，默认 0=不限制，TR-001 T13b 落地，commit 待 push）；`JobEvent` 表 + 5 个 worker 钩子（TR-001 T13a，`4e6a0ed`）；7 worker 接入统一 lease 公式（TR-002 R2，见上一条）。缺：强制每个 worker 调 `recordJobEvent`（当前是 best-effort，缺审计强度）。可立 TR-043 跟进。

#### New-F（P2 增强）继续拆 3 个超大 client

`file-list-client.tsx:1245` / `ai-client.tsx:987` / `quick-services-client.tsx:1002` 是 TR-036 9 文件拆解后剩余的真正大头（其余已 < 700 行）。`file-list-client` T36b 已拆 "批量操作 + 工具栏 + 详情面板 + 更多操作" 4 子组件走 `next/dynamic` 懒加载（1600→1245, -355）；`ai-client` T36c 已拆 input area 子组件走 lazy 懒加载（1071→987, -84, +1 lazy wrapper, 6 test 覆盖）；`quick-services-client` 拆源同步面板 / 安装预览弹窗。已通过 TR-036 实证"1.5x 系数 + 2 tick / 6 文件"可行。

#### New-G（P2 增强）i18n / QA 报告 / README 状态对账 三件套

- TR-042 i18n 覆盖审计:✅ 已落地 (T42a+T42b, commit `7242ea1`)。`scripts/i18n-coverage.ts` 扫 `src/app/components` 246 个 tsx 文件,提取 4 类属性(placeholder / title / aria-label / alt) + JSX 文本,跟 `translations.ts` 的 zh 表做精确值匹配,输出 `docs/i18n-coverage.{json,md}`。21 个单测覆盖 JSX 范围状态机 / 泛型过滤 / 中文弯引号 / data-i18n-skip 区域 / onClick 箭头函数等边界。`npm run i18n:coverage` 一键跑。实测:扫 246 文件,1410 中文串,164 已覆盖,1246 缺 (11.6% 覆盖率),最缺:加载中…(8x)、确认删除(6x)、下载(6x)、默认模型(5x)、目标节点(5x)。**待续做**:1246 缺键可立 TR-043 推进 (优先级 P2)。
- TR-029 QA 报告产品化：把当前 `.hermes/remediation-state.json` 每天自动导出到 `/api/admin/qa-report` 内部页，运维自查不依赖 cron 私有状态。
- README 状态自动对账：cron 后台跑完一个 TR-XXX 后自动 `sed` 更新本表状态列 + `changelog` 区块；避免像 2026-06-14 那样"代码已落地 / README 还写新发现"的双轨漂移。

#### R10E (TR-054) — i18n 工程化批量补齐, 27 commit 链

**目标**: 把 1246 缺键从 11.6% 推进到 22.8%, 工程化批量接入 `useI18n()` + server `t(key, locale)`, 摸清哪些大客户端组件最值得拆。

**进度**: 27 i18n commit (R9 → R10E.20), 累计 1698 i18n key (zh+en), 1410→1107 字符串, 164→252 covered, 855 待续做。

**commit 链 (R10E.7-R10E.20 本 session, 之前 R9-R10E.6 见 git log)**:
- R10E.7 login (`b2f935a`) + R10E.8 notifications (`b68885a`) + R10E.9 tickets (`d484e4d`) — server page 范式 (`getServerLocale()` + `t(key, locale)`)
- R10E.10 templates (`63edc60`) + R10E.11 image-bed (`f186c8e`) + R10E.12 requests (`a7e3e3c`) + R10E.13 announcements (`d1e8268`) + R10E.14 media/page (`075f4f4`) + R10E.15 media-item-card (`c8cbeec`) + R10E.16 tickets/[id] (`3519223`) + R10E.17 media-image-upload-panel (`de91530`) + R10E.18 media-scan-button (`4158fe4`) + R10E.19 api-tokens (`322425c`) + R10E.20 text-preview (`6071659`) — client component 范式 (`useI18n()` + `renderWithI18n as render` 测试 wrap)

**关键模式 (R10E 沉淀, 后续 R10F+ 复用)**:
- server page: `getServerLocale()` (R10E.7 新建, 读 `vps-locale` cookie) + `t(key, locale)`
- client component: `useI18n()` + 测试用 `renderWithI18n as render` alias (业务断言零改)
- inner component: 各自独立 `useI18n()` (DeployButton / CreateTemplateForm 等)
- pure fn 接受 t 作参数: `statusLabel(t, s)` / `formatSize(b, t)` / `langLabel(t, l)` / `levelLabel(t, l)` / `modeTitle(t, type)` / `scopeLabel(t, s)` / `tokenStatus(t, tok)` / `storageLabel(s, t)` / `mediaTypeLabel(m, t)`
- 占位符: `t(key).replace("{var}", val)` (useI18n 不支持第二参数)
- 命名冲突避让: `tickets.map((t) => ...)` 改 `ticket`; `removeTag(t: string)` 改 `tag`; `tags.map((t) =>` 改 `tag` (R10E.15 修了原代码 latent bug)
- 命名空间避 sibling 撞车: `serversPage.*` / `apiTokensPage.*` / `mediaUploadPanel.*` / `mediaScanButton.*` / `mediaItemCard.*` / `ticketsDetail.*` / `textPreview.*`
- 测 wrap 模式: 有 I18nProvider → t() 走 zh 表; 无 wrap → t() 返回 key; production 有 root layout wrap, 测试要手动 wrap
- `getByText` 改 regex: 改组件后 hardcoded 文本嵌进翻译消息里, `getByText("CLI")` 精确匹配失败 → 改 `/CLI/`

**收尾 (2026-06-16)**: i18n 子集测试 8/8 全过, tsc 0 错, working tree 干净 (R10E.20 push 成功, sibling T38c AI 域 zod 12 文件未 commit 待 sibling 自行收尾)。

**R10F 候选 (按字符串数排)**: `health/health-dashboard-client` (92) / `settings/settings-client` (82) / `ai/ai-client` (69) / `alert-rules/alert-rule-list-client` (59) / `servers/server-overview-details` (54) / `files/files-browser-spa` (48) / `files/file-list-client` (48) / `quick-services/quick-services-client` (45) / `docker/docker-page-client` (35) / `backups/page` (35) / `traffic/traffic-page-client` (34) / `preferences/preferences-page-client` (32) / `qa-reports/qa-reports-list-client` (34) / `recycle-bin` (25)。预计 R10F 一轮再做 8-12 个, 22.8% → ~35-40%。

---

## 📋 任务追踪编号表（TR-001 ~ TR-042）

所有项目均有稳定追踪编号 `TR-XXX`，可通过 `grep "TR-0XX" README.md` 定位。代码注释 / 测试名 / QA 报告引用 TR 编号可与本表一一对应。

> **🤖 后台自动推进**：状态列标 `⏳ 后台任务中 (Txx...)` 的 TR 由 cron job `9e36e64a75ae`（每 15min tick，模型 `MiniMax-M3 @ Api.tokenrouter.com`）自动拆 sub-task 推进。任务清单在 `~/.hermes/state/vcontrolhub-task-queue.json`，每 sub-task 完成后助手在 commit 时同步本表状态列（队列中 → 后台任务中 → ✅ 完成）。纯前端 / 脚本 / 报告类 TR 适合后台；涉及 worker / 跨进程 / 部署边界的 P0/P1 项由人工在场处理。

| 编号 | 优先级 | 主题 | 状态 |
|---|---|---|---|
| TR-001 | P1 | 后台任务业务迁移与并发控制（命令/部署/下载/定时任务） | 定时任务已迁 |
| TR-002 | P1 | Docker / QuickService / Direct Gateway 部署边界加固（失败回滚 / Direct Gateway TLS） | 主体已落地 |
| TR-003 | P2 | 前端可访问性 / 移动端 / 浏览器导航系统化收口 | 巡检 1st pass (3/35 已修) |
| TR-004 | P1/P2 | 文件预览 / 分享 Office+压缩包边界加固与文档化 | 文档化已落（docs/file-preview-sharing.md） |
| TR-005 | P2 | 文件状态一致性、远端索引刷新、存储列表分页与内存聚合 | 远端索引 T34a 已落地 (durable job + 周期任务), T34b 存储分页待续做 |
| TR-006 | P2 | 任务中心跨来源统一归档 / 长期保留策略 | ✅ 完成 (operation-task.retention 6h durable job + 5 来源) |
| TR-007 | P2 | 备份记录运维解释 — 异地 / 自动恢复演练 / 保留清理 | 主体已落地 |
| TR-008 | P2 | README 任务层级与追踪方式（轻量治理） | ✅ 完成 |
| TR-009 | P2 | 既有增强项队列（备份 / 编辑 / 媒体 / 告警 Telegram） | 队列中 |
| TR-010 | P1/P2 | 可维护性与可更改性专项治理 | 多轮推进中 |
| TR-011 | P2 | 快捷服务生命周期 — 失败回滚 / 真实 diff / Direct Gateway 边界 | 队列中 |
| TR-012 | P2 | 在线文件编辑器 — 并发修改检测 / 重载服务 / SFTP 编辑 | ✅ 完成 |
| TR-013 | P2 | VPS 运维控制台 — Direct Gateway 一键修复建议 / Quick Apps 联动 | ✅ 修复建议已落地 |
| TR-014 | P2 | 设置页高风险设置回滚 / 风险确认 / diff | ✅ 完成 |
| TR-015 | P2 | 备份策略管理 — 任务化 / 异地 / 恢复验证 / 保留清理 | 队列中 |
| TR-016 | P3 | 操作回滚（关键文件 / 配置 / 部署 undo） | ✅ 部署回滚已落地 |
| TR-017 | P2 | 可维护性热点拆分（file-list / storage / AI / QuickService） | ✅ 完成 |
| TR-018 | P2 | API 回归测试基线（AI / status / QuickService slug / 2FA） | ✅ 完成 |
| TR-019 | P2 | 领域模块边界治理（files / storage / quick-service / command / ai / backup DTO） | ✅ R10-R22 + R28.D 主体已落地 (commit `7dbf642`+`b0c229a`+`28bdcc5`+`727fcda` god-file barrel 拆 5 域 + R15 backup schema 模块); T42 加 `scripts/tr-019-dto-audit.ts` DTO 边界巡检 (5 域 23 路由当前 13% 覆盖率, 20 gap routes 列出) |
| TR-020 | P3 | 仪表盘自定义（拖拽 / 指标 / 时间范围） | ✅ 完成 (`ec5f791`+`fc65edf`+`d9e6089`：4 列 grid + HTML5 dnd 拖拽 + click 弹窗详情,16 vitest) |
| TR-021 | P2 | 可访问性收口（巡检 placeholder-only / 低可见度控件） | ✅ 主体完成 |
| TR-022 | P2 | 移动端适配（高频入口 / 复杂面板响应式） | ✅ 主体 9 轮完成 |
| TR-023 | P3 | 自动化工作流 Playbook（条件触发 / 告警联动 / 步骤编排） | 队列中 |
| TR-024 | P3 | 命令/部署执行 durable worker（DB-backed job / 跨进程取消 / 并发上限） | ✅ 主体已落地 |
| TR-025 | P3 | RBAC 角色视角巡检（按钮可见 / API 可调一致性） | ✅ 完成 (T25a + T25b, commit e129d86 + T25b) |
| TR-026 | P3 | 统一操作反馈模型（ActionResult + toast/alert + 任务中心链接） | ✅ 主体已落地 |
| TR-027 | P3 | README/测试追踪标签 | ✅ 完成 |
| TR-028 | P3 | 路由与导航真源（`docs/route-catalog.json` + 守卫脚本） | ✅ 完成 39 page / 79 API / 41 perm |
| TR-029 | P3 | 站内 QA 报告产品化（canary/cron QA + smoke evidence） | ✅ 完成 (T29a + T29b, commit da08543 + T29b) |
| TR-030 | P3 | 多租户 / 团队空间（资源隔离 / 配额 / 权限继承） | 队列中 |
| TR-031 | P3 | 成本追踪（VPS 费用 / 带宽 / 存储 / 月报） | 队列中 |
| TR-032 | P3 | 智能运维 AI（主动诊断 / 异常预测 / 自动修复建议） | 队列中 |
| TR-033 | P3 | PWA 离线支持和集成市场 | 队列中 |
| TR-034 | P1 | API 错误响应 shape 统一（`code` + `message` + `details`） | ✅ 完成 (R1 union + R2 219 处 codemod + R3 client envelope) |
| TR-035 | P2 | 环境变量集中读取层（29 文件直读 `process.env`） | ✅ 已落地 (R32, commit ca38b89) |
| TR-036 | P1 | 大客户端 bundle 拆分（9 个 client tsx ≥500 行） | ✅ 完成 (T36b + T36c + T37; file-list-client 1600→1245 / ai-client 1071→987 / quick-services-client 1002→574, 共抽 6 子组件 + 5 lazy wrapper) |
| TR-037 | P2 | API 入参 zod 校验补齐（39 个 route ad-hoc 解析） | ✅ R5 扫 2 路由 (operation-tasks + traffic/summary) + 修 helper bug。R1-R5 累计 17 路由, R6 (T38b) 走 storage 域 8 路由 (共用 `src/lib/storage/schema.ts` + 17 schema 单测) → storage 域 100%, 总体 11/23 routes (47.8%), 剩 12 路由待 R7+ (ai/files/command 域) |
| TR-038 | P2 | God-object service 继续拆分（5 个 ≥500 行 service） | ✅ 主体已落地（R18-R22 + R28.D） |
| TR-039 | P2 | 领域 DTO 边界续做（operation-task / runtime-settings / files / ai / deployment） | ✅ 完成 (1/1 leak 修 + 4 域 0 leak 审计; commit 见 git log) |
| TR-040 | P2 | N+1 查询审计与修复（command / command-template / quick-service） | ⏳ R1 部分完成 (R1.1 syncSource 全并行 + R1.2 syncLocalShareDirectory batch; R1.3 rollback statuses 跳过 — 已是 Promise.all 并行 + runs 数量小) |
| TR-041 | P2 | 自定义错误类（273 处 `throw new Error()` 分 61 文件） | ✅ 已落地 (commit 93ddbb7) |
| TR-042 | P3 | i18n 文案覆盖度审计（`translations.ts` keys 与 app/**/*.tsx 对账） | ✅ 完成 (T42a+T42b, commit 7242ea1) |
| TR-047 | P2 | RBAC 静态审计扫描器精度提升（catalog 字典化 + audit 4 种 enforcement form + 多行 + 白名单） | ✅ 已落地（drift 41 → 0），`scripts/build-route-catalog.ts` `declaredPerms` 改用 `RBAC.PERMISSIONS` 字典；`scripts/rbac-audit.ts` 加 `sessionHasPermission` / `verifyBearerToken` 识别、3 段 perm 正则、多行 sessionHasPermission fallback、`intentionallyPublic` 白名单 16 项（login/signout/2FA/share/openapi/status/dashboard 等公开路由）、`dynamicPermRoutes` 白名单 2 项（`storage/sftp-ops` / `files/list` 三元/动态变量 enforcement）。22 单测全过。|
| TR-048 | P2 | `app-sources` 路由测试覆盖（GET/POST/PATCH/DELETE 全分支） | ✅ 已落地，`src/app/api/app-sources/__tests__/route.test.ts` 12 单测：本地 catalog 与 installed services 合并、`includeApps=false` 跳过 remote、POST 验权 + 校验 name/url、PATCH sync/toggle 双分支、DELETE by id query。 |
| TR-049 | P2 | 存储节点实时健康探测（SFTP / Direct Gateway）— `/api/status` storage check 显示 6 节点 0 健康 0 异常 6 待探测；探测从未跑过，UI 看不到节点状态。 | ✅ 已落地（`/api/status` 触发 lazy probe）：`src/lib/storage/health.ts` 新增 `scheduleStorageNodeHealthProbe`（fire-and-forget + `setImmediate` 推到下个 tick，避免阻塞状态响应）+ `probeAllStaleStorageNodes`（查询 lastHealthCheckAt > 5min 或 null 或 UNKNOWN 的节点，`Promise.allSettled` 并行调 `checkStorageNodeHealth` 写回 DB，per-node `.catch` 吞错，`take: 50` 防爆量）；`getPublicStatus` 在 storage 聚合后无条件 schedule（probe 函数内部短路，0 stale 时无开销）。`checkStorageNodeHealth` 早就存在 (R28.D-1, 已有 5 个 vitest) — 现在终于被自动触发。5 个 scheduler 单测 + 1 个 trigger 测 + 1911 全量测试 0 regression。 |
| TR-050 | P2 | VPS 健康检查实时 TCP ping — `/api/status` servers check 注释 "已启用 5 台 VPS，未做实时 SSH/网络探测"；known-good 显示 healthy 误导用户。 | ✅ 已落地（health rollup 接入轻量 TCP ping 前置）：`src/lib/server/connectivity.ts` `tcpProbe(host, port, 2s)` net.Socket 三次握手 + errno 友好化；`service-collect.ts` 在 collectServerMetrics 前先 tcpProbe，**TCP 失败 = offline + "网络不可达: <errno>"**（跳过 SSH），**TCP ok + SSH 失败 = warning + "SSH 不可达 (主机在线, RTT <X>ms): <err>"**（区分"网络断"与"主机活 SSH 挂"），`ServerHealth.latencyMs` 暴露 RTT 供监控面板展示。7 个 service-collect 集成测 + 5 个 connectivity 单测覆盖：disabled 跳过 / TCP fail→offline / TCP ok+SSH fail→warning / TCP ok+采集 throw→warning / 全 healthy / 高负载→critical / 5 server rollup 计数。 |
| TR-051 | P1 | `ADMIN_INITIAL_PASSWORD` env vs DB hash 不一致 — `.env.local` 密码登录返 invalid，DB hash 不匹配（memory 记录的 quirk，生产化后是阻塞门）。 | ⏳ 建议：boot 时若 DB hash 与 env 不一致，自动 reseed admin（开发环境）或显式报错（生产）。 |
| TR-052 | P3 | 落地页 `/` 307→login 后无 dashboard — 默认页 redirect 而非真 dashboard。 | ⏳ 建议：首屏直接看概览，做一个 `/dashboard` 路由专属页面。 |
| TR-053 | P1 | 公开 `/api/status` 泄露存储节点详情 — 未登录可见 `"6 个存储节点, 0 健康, 0 异常, 6 待探测"`。 | ⏳ 建议：公开端点只返回 `overall: warning`，详细 checks 给登录后页面。 |
| TR-054 | P2 | i18n 1246 缺键工程化补齐 — TR-042 报告显示 1246 个 hardcode 字符串未走 t() 调用,工程化批量补齐(top-N 字符串 + 各模块调用点)。 | ✅ R1-R10E.20 完成 (27 i18n commit, 1410→1107 字符串,164→252 covered,11.6%→22.8%,+88 covered,−303 hardcode,855 待续做)。详情见 R10E 段。 |

---

## 🗺️ 下一步升级方向

按 P 级排序，配 `<!-- TR-XXX -->` 编号定位。已完成项已从本节移除，保留在「已完成的关键闭环」与各 R-轮交付小节中追溯。

### P1 — 阻塞性

- [ ] **API 错误响应统一 shape**（TR-034）— `apiError("CODE", message, details, status)` codemod。
- [x] **大客户端 bundle 拆分**（TR-036）— 每个 ≥500 行 client 拆子模块 + `next/dynamic` 懒加载。T36b 完成 file-list-client 1600→1245 (-355)；T36c 拆 ai-client input area 子组件 1071→987 (-84, +1 lazy wrapper + 6 test, 既有 32 test 0 业务改)；T37 续拆 quick-services-client 1002→574 (-428, +4 子组件 ServiceCard/InstallDialog/ConfigPreview(lazy)/SourcesPanel + 1 lazy wrapper, 既有 27 test 0 业务改)。
- [ ] **后台任务业务迁移与并发控制**（TR-001）— 命令/部署/下载/定时任务补 durable worker，全局/按节点并发上限，可观测日志流。
- [ ] **Direct Gateway 传输边界**（TR-002）— TLS 反代 / VPN / 防火墙默认部署或更细可达性探测。
- [x] **下载入队失败被吞**（New-A）— `src/app/api/downloads/route.ts` route 端 `await enqueueDownloadExecutionJob` 后再返 201，失败回滚 `downloadTask.status = FAILED` + 5xx + `code: DOWNLOAD_DISPATCH_FAILED` + `auditUserAction("download.dispatch_failed")`。durable worker 入口配合 New-C idempotency guard 防 FAILED 后重试 side effects。3 个新测：单任务回滚 / batch 部分失败回滚 / happy path。
- [x] **定时任务 tick 竞态**（New-B）— `enqueueScheduledTaskTickJob` 改 `prisma.$transaction(async tx => { hasActive(tx); enqueueJob() })` 串行化存在性检查 + 入队；`dispatchDueTask` 入队前行级 CAS `updateMany({id, status, nextRunAt: oldNext}, data: {nextRunAt: claimSentinel})`，count===0 跳过 + `info` 日志；失败回滚原 nextRunAt。`dispatched` counter 只数 CAS 赢 + createCommandRequest 成功的任务。3 个新测：CAS count=0 / CAS 赢但 createCommandRequest 失败回滚 / 事务存在性检查。
- [x] **下载 worker 状态错位**（New-C）— `execution-worker.ts` handleClaimedJob dispatch 前查 `downloadTask.status`，COMPLETED→completeJob+`status:already_completed`、FAILED/CANCELLED→failJob+`retryAfterMs:undefined`（不重试 side effects）；post-throw re-fetch 业务行也走终态分支。接受 T13b maxAttempts=3 重试，aria2 transient 错误自动恢复。4 个新测：COMPLETED / FAILED / CANCELLED / post-throw-FAILED。
- [x] **`instrumentation.ts` 启动路径不全**（New-D）— 全部 worker 启动迁到 `instrumentation.ts` + `src/lib/workers/registry.ts` 8 worker 单一注册表 + SIGTERM 优雅停机。已合 T13c 落地。
- [ ] **admin 密码 env vs DB hash 不一致**（TR-051）— boot 时若 DB hash 与 env 不一致，开发环境自动 reseed admin，生产环境显式报错。阻塞门。
- [ ] **公开 `/api/status` 泄露存储节点详情**（TR-053）— 未登录可见 6 节点探测状态。公开端点只返 `overall`，详细 checks 给登录后页面。安全/隐私。

### P2 — 用户体验和可运营性

- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。
- [x] **在线文件编辑器剩余增强**（TR-012）— **SFTP 编辑**（T17a 落地, `localEditable` 扩到 SFTP 节点 + `TextPreviewClient` 接 `driver/nodeId/relativePath` + `handleSave` 走 `/api/storage/sftp-ops action=write` + 响应 `byteSize` 字段返回 + 2 个新测覆盖 routing + 错误显示）+ **保存后重载服务**（T17b 落地, `POST /api/servers/[id]/reload` 走 `execRemoteCommand`，白名单约束 `unit:^[A-Za-z0-9._@-]{1,128}$` 防 shell 注入，`kind:"systemd"` 拼 `systemctl reload <unit>` (失败回退 `restart`)，`kind:"compose"` 拼 `cd <dir> && docker compose up -d [service]`，`RELOADABLE_CONFIG_MAP` 限定 nginx.conf/redis.conf/sshd_config/httpd.conf/my.cnf/docker-compose.yml 等候选配置，`TextPreviewClient` 串联 "保存 → 重载" 流程，状态机扩 `reloading/reloaded` + `reloadMessage`，amber 配色 "保存并重载 `<unit>`" 按钮在 editMode + SFTP + serverId + reloadUnit 同时满足时显示，6 个 reload route 测 + 3 个 frontend 测 = 9 新测覆盖 routing/错误/状态机)。
- [x] **设置页高风险设置**（TR-014）— M01：↺ 恢复默认按钮 + Save diff 角标 + high 风险 confirm modal。
- [x] **备份策略管理**（TR-015）— **任务化执行**（T13a/T13b jobs 表迁移已落地） + **保留策略自动清理**（T16 落地, `pruneOldBackupRecords` planner + `BACKUP_RETENTION_JOB_TYPE` durable job + `/api/backups/retention` API + `/backups` RetentionButton UI + 11 测试）。**待续做**: 异地备份、恢复验证演练。
- [x] **仪表盘自定义**（TR-020）— `ec5f791`+`fc65edf`+`d9e6089`：4 列 grid（`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`）+ HTML5 native dnd 拖拽排序（`order: N` CSS 注入, 0 依赖）+ click widget 弹 dialog 详情（深拷贝 live widget DOM, ESC/backdrop 关闭）+ 9 i18n key + 16 vitest 覆盖 customize 流程/拖拽状态/详情弹窗。
- [x] **环境变量集中读取层**（TR-035）— 扩 `lib/config/env.ts`，23 文件已迁移。
- [ ] **API 入参 zod 校验补齐**（TR-037）— 39 ad-hoc route 走 schema。R1-R5 累计 17 路由, R6 (T38b) 走 storage 域 8 路由 (共用 `src/lib/storage/schema.ts` 10 个共享 schema + 17 schema 单测 + 0→100% storage 域 + 修 sftp-ops 残 tsc `z.infer` namespace 错), 总体 11/23 routes (47.8%)。**待续做**: ai 域 7 路由 (T38c) / files 域 3 路由 (T38d) / command 域 1 路由 (T38e), 3 个 sub-tick 推到 ~95% 覆盖率。
- [x] **领域 DTO 边界续做**（TR-039）— 5 域全域 DTO 闭环。
- [ ] **N+1 查询修复**（TR-040）— 3 个候选文件。
- [x] **自定义错误类**（TR-041）— `AppError` 子类配合 TR-034。
- [ ] **Direct Gateway TLS / 跨 worker 并发上限 / lease 策略**（New-E）— 立 TR-043 跟进，deploy 默认接 Caddy 反代 TLS、并发上限与 lease 公式、强制 `recordJobEvent`。
- [x] **继续拆 3 个超大 client**（New-F）— `file-list-client` 1245 ✅ T36b (1600→1245) / `ai-client` 1071 ✅ T36c (1071→987) / `quick-services-client` 1002 ✅ T37 (1002→574, +4 子组件 + 1 lazy wrapper)。
- [x] **存储节点实时健康探测**（TR-049）— `/api/status` 触发 lazy probe（`scheduleStorageNodeHealthProbe`），fire-and-forget + setImmediate 推到下个 tick，5min stale 阈值 + 50 上限。详见 TR-049 行。
- [x] **VPS 健康检查实时 TCP ping**（TR-050）— `servers` check known-good 显示 healthy 误导用户。加轻量 TCP ping，failures 标 warning。✅ `connectivity.ts` + `service-collect.ts` 接入，详见 TR-050 行。
- [ ] **i18n 覆盖 / QA 报告 / README 状态对账**（New-G）— TR-042 / TR-029 / 自动对账脚本三件套。
- [ ] **落地页真 dashboard**（TR-052）— `/` 307→login 后无 dashboard，首屏直接看概览，做一个 `/dashboard` 路由专属页面。

### P3 — 长期愿景

- [ ] **自动化工作流**（TR-023）— 条件触发、告警联动、步骤编排。
- [x] **RBAC 角色视角巡检**（TR-025）— T25a 落地 (`scripts/rbac-audit.ts` + 4-source cross-ref + 11 个单测 + `npm run rbac:audit`),T25b 落地 (脚本扩 withApiRoute-permission 检测,扫出 41 perm × 4 role × 79 API × 39 page,输出 `docs/rbac-audit.json` + `docs/rbac-audit.md`;真实漂移 22 个 `api-no-declared-perm` + 19 个 `api-decl-perm-unused` 待人工修 — 需按 perm 单独决定加/不改,机械替换会改坏语义)。
- [ ] **统一操作反馈模型推广**（TR-026）— 推广到剩余页面。
- [x] **站内 QA 报告产品化**（TR-029）— T29a 落地（list + detail + 读 .hermes/ + 复用 admin/qa-reports 模式），T29b 落地（趋势卡片 + 日柱图 + 模块覆盖 + 最近 5 run + 失败摘要 + autonomous-maintenance-state.json 接入）。
- [ ] **多租户 / 团队空间**（TR-030）。
- [ ] **成本追踪**（TR-031）。
- [ ] **智能运维 AI**（TR-032）。
- [ ] **PWA 离线支持和集成市场**（TR-033）。
- [x] **i18n 文案覆盖度审计**（TR-042）— `scripts/i18n-coverage.ts` 扫 `src/app/components` 246 个 tsx 文件的中文串 vs `translations.ts` 的 zh 表,输出 `docs/i18n-coverage.json/md` (覆盖率 + 模块/文件级清单 + 缺键排行),21 个单测覆盖 JSX 范围状态机 / 泛型过滤 / 中文弯引号 / data-i18n-skip 区域 / onClick 箭头函数等边界。`npm run i18n:coverage` 一键跑。实测:扫 246 文件,1410 中文串,164 已覆盖,1246 缺 (11.6% 覆盖率),最缺:加载中…(8x)、确认删除(6x)、下载(6x)、默认模型(5x)、目标节点(5x)。

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
