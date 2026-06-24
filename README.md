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

> 首次运行会自动生成 `.env.local` 模板并暂停，填写数据库密码、密钥后重新运行即可。

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
| 功能页面 | 46 |
| API 端点 | 108（withApiRoute 全覆盖，4 个特殊路径合理豁免） |
| 数据模型 | 53 |
| UI 组件 | 27 |
| 代码行数 | ~152,300（src 扫描） |
| 测试 | 339 文件 / 2403 tests |
| Docker 应用模板 | 44 (本地) + 187 (社区) |

---

## 🔬 全量代码审查（2026-06-24）

**审查范围**：152,300 行 TypeScript/TSX，108 API 路由，46 页面，53 数据模型，339 测试文件。
**方法**：静态 grep 信号 + 架构分析 + verify 链（tsc + lint + 2403 tests + build + build:runtime）全通过 + 浏览器实地走查（dashboard / servers / quick-services）。

### ✅ 现状健康评估

| 维度 | 评分 | 说明 |
|---|---|---|
| 代码质量 | 9/10 | 0 `@ts-ignore`，0 循环依赖，0 prisma 在 client |
| 认证/授权 | 10/10 | 108/108 路由覆盖，4 个豁免全合理（login/share/2fa/openapi） |
| 安全 | 8/10 | DOMPurify 全覆盖，CSRF 防护，AES-256 加密；5 个 postcss moderate vuln（Next.js 内置，无法单独升） |
| 测试 | 9/10 | 2403 tests 全 pass，tsc + lint 0 错误 |
| i18n | 9/10 | 141 useI18n()，76 字典文件，197 light: 全语义（0 冗余） |
| 前端 UX | 7/10 | 5 个功能页无侧边栏入口，AI 客户端无响应式 |
| 架构 | 8/10 | 97 findMany 无 take 分页保护，3 个路由不走统一错误格式 |
| 运维 | 9/10 | systemd + caddy + smoke + 双 build 全套完整 |
| **综合** | **8.6/10** | **结构健康，剩余均为 P2/P3 改善项** |

### 🚧 现有问题（按优先级）

**P1 — 功能可发现性**
- [ ] **5 个功能页无侧边栏入口** — `/monitoring`（系统监控图表）、`/preferences`（用户偏好设置）、`/cost-summary`（成本追踪）、`/ai-ops`（智能运维）、`/image-bed`（图床中心）均无法从侧边导航栏直接访问，只能靠 URL 直接输入或其他页面跳转。

**P1 — 功能逻辑不完善**
- [ ] **`downloads` 彻底清除（purge）无二次确认** — `downloads-client.tsx` 的 `purge=1` 操作（从 Aria2 彻底删除任务文件）点击后直接执行，无 AlertDialog/confirm 拦截，误操作风险高。
- [ ] **审批中心无批量审批** — `/requests` 页面只能逐条审批，无"全选 + 批量通过"，高并发审批场景下效率低。
- [ ] **`/traffic` 流量页面无图表** — 流量数据以纯文字/数字列表展示，无带宽走势折线图或柱状图，数据不直观，无法感知趋势。
- [ ] **`/monitoring` 监控依赖轮询，无实时推送** — 使用 `setInterval` 定时拉取，无 WebSocket/SSE，数据有明显延迟，不适合高频实时场景。

**P2 — UI 直观性与一致性**
- [ ] **按钮色彩体系碎片化** — 主操作按钮存在 cyan-300/400/500/600 四档混用；危险操作同时使用 `bg-red-*` 和 `bg-rose-*` 两套色，无统一 design token，视觉噪音明显。
- [ ] **4 个核心页面缺少 PageHeader** — `/ai`、`/media`、`/image-bed`、`/storage` 无 eyebrow/title/description 三元素，用户进入页面后缺少上下文引导。
- [ ] **约 13 处 PageHeader 无 description** — `downloads`、`notifications`、`tickets`、`scheduled-tasks`、`snippets`、`preferences` 等页面只有标题，缺少功能说明副文案，新用户引导不足。
- [ ] **10 种硬编码十六进制颜色** — `#f8fafc`、`#0c0f1a`、`#1e293b` 等色值散落在 TSX 文件中，绕过 Tailwind/CSS 变量体系，暗色模式切换时存在色彩不一致隐患。

**P2 — 工程规范**
- [ ] **`i18n:key-check` 未接入 verify 链** — `npm run verify` 不包含 `npm run i18n:key-check`，新的 `t(key)` 调用若字典缺 key 不会被 CI 门禁捕获。
- [ ] **3 个路由不用 TR-034 统一错误格式** — `api/snippets`、`api/playbooks/[id]`、`api/deployments/[id]/rollback` 直接返回 `NextResponse.json({ error: message })`，不走标准 `{ error, code, details }` 结构。
- [ ] **97 处 `findMany` 无 `take` 保护** — 大部分列表查询无分页上限，数据量大时有内存和性能风险。
- [ ] **`process.env.ENCRYPTION_KEY` 直接读取** — `src/lib/crypto/service.ts` 直接读 `process.env` 而不走项目统一的 config 模块。

**P3 — 长期改善**
- [ ] **`/status` 页面有 loading.tsx 但缺 error.tsx** — 公开状态页出错时无自定义错误界面。
- [ ] **68 处 `p-5`/`p-7` 奇数间距混入** — Tailwind 标准档为 p-4/p-6/p-8，奇数档混入导致视觉节奏不统一。
- [ ] **AI 客户端（1030 行）无响应式断点** — `ai-client.tsx` 无任何 `sm:/md:/lg:` 类，移动端为纯桌面宽度。
- [ ] **`zod bodySchema/querySchema` 仅 28 处采用** — TR-037 迁移未完成，约 80 条路由仍手动解析 body/query。
- [ ] **5 项 moderate npm 安全漏洞** — postcss XSS（GHSA-qx2v-qp2m-jg93）在 Next.js 内置依赖链，待官方升级。
- [ ] **qa-reports 依赖 `.hermes` 运行时文件** — 纯 fresh install 环境（无 Hermes agent）下页面显示为空，建议添加空状态说明。

## 📋 任务追踪

完整 TR 编号与历史见 `git log`。当前未完成项：

- [ ] **后台任务业务迁移与并发控制**（TR-001）— 命令/部署/下载/定时任务补 durable worker，全局/按节点并发上限，可观测日志流。
- [ ] **Direct Gateway 传输边界**（TR-002）— TLS 反代 / VPN / 防火墙默认部署或更细可达性探测。
- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。

## 🗺️ 下一步升级方向

按 P 级排序。已完成项已从本节移除。

### P1 — 阻塞性
- [ ] **5 个功能页补充侧边栏入口** — `/monitoring`、`/preferences`、`/cost-summary`、`/ai-ops`、`/image-bed` 加入侧边栏或对应父页面入口。
- [ ] **后台任务业务迁移与并发控制**（TR-001）— 命令/部署/下载/定时任务补 durable worker，全局/按节点并发上限，可观测日志流。
- [ ] **Direct Gateway 传输边界**（TR-002）— TLS 反代 / VPN / 防火墙默认部署或更细可达性探测。
- [ ] **downloads purge 操作补二次确认** — 彻底删除任务文件前加 AlertDialog 拦截。
- [ ] **审批中心支持批量审批** — 全选 + 批量通过/拒绝。

### P2 — 用户体验和可运营性
- [ ] **`/traffic` 流量页补图表** — 带宽走势折线/柱状图，支持时间段切换。
- [ ] **`/monitoring` 改为 WebSocket/SSE 实时推送** — 替换 setInterval 轮询，降低数据延迟。
- [ ] **按钮色彩体系统一** — 主色统一到 `cyan-500`，危险色统一到 `rose-500`，写入 globals.css token。
- [ ] **4 个核心页面补 PageHeader** — `/ai`、`/media`、`/image-bed`、`/storage` 补 eyebrow/title/description。
- [ ] **`i18n:key-check` 加入 verify 链** — 一行改 package.json。
- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。
- [ ] **统一操作反馈模型推广**（TR-026）— 推广到剩余页面（snippets / playbooks / deployments rollback 先行）。
- [ ] **高频 findMany 添加 take 分页保护** — 优先 `/api/users/permissions`、`/api/dashboard/analytics`。

### P3 — 长期愿景
- [ ] **自动化工作流**（TR-023）— 条件触发、告警联动、步骤编排。
- [ ] **AI 客户端响应式布局** — `ai-client.tsx` 添加移动端断点支持。
- [ ] **约 13 处 PageHeader 补 description** — downloads / notifications / tickets 等页面补功能说明副文案。
- [ ] **硬编码颜色迁移 CSS 变量** — 10 种十六进制色值统一走 Tailwind/CSS token。
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
- [ ] **定时自动备份** — Cron 表达式配置（当前无 schedule 实现，只能手动触发）
- [ ] **备份保留策略 UI** — 保留最近 N 份，自动清理旧备份（后端 `service-policy.ts` 有基础，无 UI）
- [ ] **备份完整性校验** — 备份完成后 SHA256 checksum 验证

### 分享链接
- [ ] **访问密码保护** — 访问分享链接需输入密码（当前只有过期时间）
- [ ] **最大下载次数限制** — 超过次数后链接失效（`accessCount` 字段已计数但无上限判断）

### 全局搜索
- [ ] **动态内容搜索** — 接入服务器名称、Playbook 标题、快捷服务名的实时 API 搜索（当前只覆盖静态导航页面）

### Docker 管理
- [ ] **Docker 网络/Volume 管理** — Network 列表与 Volume 管理（创建/删除/inspect）

### 通知中心
- [ ] **补充通知类型** — `backup_completed`、`backup_failed`、`login_alert`（异常登录）、`cron_failed`、`playbook_failed`

### 审计日志
- [ ] **导出 CSV / JSON** — 支持按时间范围、操作类型过滤后导出（当前纯展示，无导出逻辑）

### API Token
- [ ] **细粒度 scope** — `files:read`、`vps:read`、`vps:reboot`、`backup:read` 等（当前只有默认 `read`）
- [ ] **scope 勾选 UI** — 创建 Token 时提供权限勾选界面

### 公开状态页
- [ ] **故障/维护公告** — 管理员发布事件公告（当前只有整体状态指示灯）
- [ ] **历史可用率图表** — 90 天 uptime 热力图 / SLA 统计

### Playbook
- [ ] **步骤拖拽排序** — `@dnd-kit` 实现步骤顺序拖拽（当前为表单式编辑，742 行）

### AI 助手
- [ ] **补充 AI 工具调用** — `list_backups`、`run_playbook`、`query_traffic`、`manage_cron`（当前 8 个工具均为服务器状态/命令类）

### 定时任务
- [ ] **失败原因持久化** — 将每次执行的错误信息写入数据库（当前 `lastResult` 字段有但错误详情仅打日志）
- [ ] **可配置重试次数** — 当前硬编码 3 次
- [ ] **失败告警通知** — 任务连续失败 N 次后触发告警渠道通知

---

## 🎨 UI 美化待办（代码审查 2026-06-24）

基于静态分析 + 浏览器走查确认，按影响大小排列。

### 🔴 视觉 Bug（直接影响可用性）
- [ ] **`/alert-rules` 和 `/playbooks` 页眉英文** — `alertRulesPage.eyebrow` 和 `playbooksPage.eyebrow` 字典值为 `"Automation"`，中文模式下直接显示英文。应改为 `"自动化"`（zh 字典）。
- [ ] **`/files` 目录树列宽过窄** — 左侧节点名称普遍被截断（如 `本机默认存储（L…`），`files-browser-spa.tsx` sidebar 宽度未设最小宽度，应加 `min-w-[160px]` 或 `w-48`。
- [ ] **`global-error.tsx` 全部用内联 style** — 全局错误页的字号/颜色/间距都是 `style={{ fontSize:28... }}`，与其余页面风格割裂，应迁移到 Tailwind className。

### 🟠 设计一致性
- [ ] **按钮主色拆分三对** — `cyan-400`/`cyan-500`、`rose-400`/`rose-500`、`emerald-400`/`emerald-500` 在 JSX 中随意切换（静态扫描：cyan-400 用 121 次、cyan-500 用 111 次）。建议统一：主色 `cyan-500`，危险 `rose-500`，成功 `emerald-500`，hover 态才降一档。
- [ ] **圆角 5 种混用** — `rounded`（无后缀）、`rounded-md`、`rounded-lg`、`rounded-xl`、`rounded-2xl` 同时存在。建议规范：卡片 `rounded-xl`，小控件 `rounded-lg`，badge/按钮 `rounded-full`，去掉无后缀 `rounded` 和 `rounded-md`。
- [ ] **Input 样式 3 种变体** — `rounded-2xl + bg-slate-950 + py-3`、`rounded-lg + bg-white/[0.04] + py-2.5`、`rounded-lg + bg-[var(--border)] + py-2` 混用。建议提取统一 `inputBase` className 或 InputBase 组件。
- [ ] **`text-white/82` 异常 opacity** — `src/app/login/page.tsx:111` 的 `text-white/82` 是随意取值，应改为 `/80`（已有大量 `/80` 用例）。
- [ ] **`/quick-services` 三卡宽度失衡** — `lg:grid-cols-[1.2fr_0.9fr_0.9fr]` 使"运行概览"卡偏宽 40%+，改为 `lg:grid-cols-3` 等宽更协调。

### 🟡 细节打磨
- [ ] **Loading skeleton 全部只有 5 行** — 35 个 `loading.tsx` 内容极简（spinner 或空 div），数据密集页（`/files`、`/health`、`/deployments`）应实现与页面结构匹配的骨架屏。
- [ ] **`transition-all` 19 处** — 会触发全属性重绘，性能较差，建议改为 `transition-colors` 或 `transition-transform`（具体属性）。
- [ ] **`/playbooks` 空状态无引导 CTA** — 空列表时只有说明文字，缺少内嵌"新建 Playbook"按钮，用户难以发现操作入口。
- [ ] **文字 opacity 档位过多** — `/10`、`/20`、`/25`、`/30`、`/40`、`/50`、`/60`、`/70`、`/80`、`/82` 共 10 档，建议收敛为 `/20`/`/50`/`/70`/`/80` 四档。

私有项目 — 未经授权不得使用、复制或分发。
