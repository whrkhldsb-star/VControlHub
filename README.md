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

**审查范围**：152,300 行 TypeScript/TSX，108 API 路由，46 页面，53 数据模型，359 测试文件。
**方法**：静态 grep 信号 + 架构分析 + verify 链（tsc + lint + i18n:key-check + 2394 passed / 1 skipped + build + build:runtime）全通过 + 浏览器实地走查（dashboard / servers / quick-services）。

### ✅ 现状健康评估

| 维度      | 评分       | 说明                                                                                              |
| --------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 代码质量  | 9/10       | 0 `@ts-ignore`，0 循环依赖，0 prisma 在 client                                                    |
| 认证/授权 | 10/10      | 108/108 路由覆盖，4 个豁免全合理（login/share/2fa/openapi）                                       |
| 安全      | 8/10       | DOMPurify 全覆盖，CSRF 防护，AES-256 加密；5 个 postcss moderate vuln（Next.js 内置，无法单独升） |
| 测试      | 9/10       | 2456 tests pass / 1 skipped，tsc + lint 0 错误                                                    |
| i18n      | 9/10       | 141 useI18n()，76 字典文件，197 light: 全语义（0 冗余）                                           |
| 前端 UX   | 8/10       | 5 个功能页侧边栏入口已补齐；AI 客户端响应式已优化                                               |
| 架构      | 8/10       | 21 处 findMany 仍未显式 take（storage 子模块 8 处已加上界 take，本轮收敛），108/108 路由全部走 TR-034 统一错误格式                              |
| 运维      | 9/10       | systemd + caddy + smoke + 双 build 全套完整                                                       |
| **综合**  | **8.6/10** | **结构健康，剩余均为 P2/P3 改善项**                                                               |

## 📋 待办清单（统一）

> 整合原"现有问题 / 任务追踪 / 下一步升级方向 / 功能完善建议 / UI 美化 / 前端可维护性 / 性能优化 / 安全加固 / 依赖升级"九节而成。已完成项已直接删除，仅保留未完成或部分完成的真待办。每条尾部 `[tag]` 标注类别。

### P1 — 阻塞或核心

> 当前无未完成 P1。TR-001（后台任务 durable worker + 全局/按用户/按节点并发上限 + JobEvent 可观测日志流 + 单一注册表 + SIGTERM 优雅停机 + `/api/admin/workers` 健康检查）与 TR-002（Direct Gateway TLS 加固 + UI 风险 banner + 启动期公网暴露探测）已全部落地；详见 `git log --grep="TR-001\|TR-002"`。
>
> 2026-06-29 修补：commit 8ec51ae（Sentry 集成）误覆盖 `src/instrumentation.ts`，回归性删除 `startWorkerLifecycle / verifyAdminPasswordConsistency / scheduleDirectGatewayExposureProbe / bigint-patch` 四处 bootstrap 调用。**生产服务靠旧编译产物仍在跑，但下次 `next build` 会丢失全部 worker / TR-051 校验 / TR-002 R4 探针**。已在 c3b1da3 恢复源文件并通过 tsc + 359 测试文件 + build。

### P2 — 用户体验与工程规范

- [ ] **快捷服务剩余增强**（TR-011）— 失败回滚、真实配置变更 diff/回滚记录、Direct Gateway 边界加固。 `[功能]`
- [ ] **`findMany` 显式上界继续收敛** — 精扫剩余 21 处 findMany 未显式 `take`（funnel: 提取每个 findMany 调用 args 块判 `take` 关键字；本轮已完成 storage 子模块 8 处加上界 take，commit 7ca982d）。剩余分布：`src/lib/{ai,command,cost,scheduled-task}/*` 各 ×3、`src/lib/{server,settings,share-link}/*` 各 ×2、其余分散 9 个 service ×1。逐处评估是否需补 `take` 防止数据量增长。**可分给弱模型**：剩余 21 处多为单 service 文件局部加 take，机械化适合 glm4.7 等。 `[架构]`
- [ ] **`zod bodySchema/querySchema` 全面迁移**（TR-037 续）— 已完成 4 个纯 JSON 写路由；剩余约 53 条混合 FormData/JSON + wantsHtml/wantsJson 分叉写路由需逐条评估迁移到声明式校验。 `[安全/可维护性]`
- [ ] **SSH 多 Tab / 多会话** — 同时连接多台 VPS，标签页切换。 `[功能]`
- [ ] **SSH 内文件传输** — 终端会话内直接拖拽上传/下载（SFTP over SSH）。 `[功能]`
- [ ] **历史可用率图表** — 公开状态页补 90 天 uptime 热力图 / SLA 统计。 `[功能]`
- [ ] **Playbook 步骤拖拽排序** — `@dnd-kit` 实现步骤顺序拖拽（当前为表单式编辑，742 行）。 `[功能]`
- [ ] **备份定时自动备份** — 当前 `BackupRecord` 模型仅手动触发，可借通用 `ScheduledTask` 跑 backup 脚本，但缺一等公民配置 UI / cron 字段；建议要么新增 `BackupSchedule` 模型，要么在 backup 页内联挂接 ScheduledTask 创建器。 `[功能]`

### P3 — 长期愿景与渐进式改善

- [ ] **自动化工作流**（TR-023）— 条件触发、告警联动、步骤编排。 `[功能]`
- [ ] **多租户 / 团队空间**（TR-030）。 `[架构]`
- [ ] **成本追踪完善**（TR-031）— `/cost-summary` 页面已落地，待接入自动采集数据源。 `[功能]`
- [ ] **智能运维 AI 完善**（TR-032）— `/ai-ops` 页面已落地，待丰富推荐执行逻辑。 `[功能]`
- [ ] **PWA 离线支持和集成市场**（TR-033）— Service Worker 基础已就绪（`public/sw.js`），待完善离线体验。 `[功能]`
- [ ] **按钮 cyan 散落用法渐进收敛** — 已有 `<ActionButton>` + `--color-action*` token 体系；存量代码中散落的 `cyan-300/400/500/600` 手写 utility 仍属长尾迁移任务，新代码请直接使用 `<ActionButton>` 而非手写 cyan utility。 `[UI]`
- [ ] **文字 opacity 进一步合并** — 当前主干保留 `/10`/`/20`/`/30`/`/50`/`/60`/`/70`/`/80` 七档语义；如视觉一致性允许，可继续向 4 档收敛（low/mid/high/full）。 `[UI]`
- [ ] **10 种硬编码十六进制颜色** — 全部为 xterm 主题 / PWA manifest / SVG 占位 / sparkline 数据色 / gradient stops 等不可 token 化场景，如需进一步抽象可后续单独审视。 `[UI]`

### P3 — 性能 / 包体积

- [ ] **API 响应缓存继续推广** — `src/lib/cache.ts` 的 `withCacheHeaders()` 已用于 `/api/dashboard/analytics` 与 `/api/status`；其余只读端点可按"登录态短缓存 / 公开长缓存"模式继续接入。 `[性能]`
- [ ] **更多低变动页面改 ISR** — 已有 `/snippets`、`/announcements`、`/api-tokens`、`/shares` 四页改为 `revalidate = 60`；其余仍是 `force-dynamic` 的页面可逐页评估是否值得 ISR 化。 `[性能]`

### P3 — 安全 / 依赖

- [ ] **5 项 moderate npm 安全漏洞** — postcss XSS（GHSA-qx2v-qp2m-jg93）在 Next.js 内置依赖链，待官方升级。 `[安全/依赖]`
- [ ] **同大版本依赖小升** — `npm update` 即可：`@tailwindcss/postcss` 4.3.0 → 4.3.1、`@types/react` 19.2.15 → 19.2.17、`@vitejs/plugin-react` 6.0.2 → 6.0.3、`cron-parser` 5.5.0 → 5.6.0、`otplib` 13.4.0 → 13.4.1、`tsx` 4.22.3 → 4.22.4、`vitest` 4.1.7 → 4.1.9。 `[依赖]`
- [ ] **跨大版本依赖（需验证）** — `typescript` 5.9 → 6.0（breaking, 升前跑全量 tsc）、`eslint` 9 → 10（配置格式变化）、`@types/node` 20 → 26（API 类型变化）、`undici` 7 → 8（Next.js 锁定，不要单独升）。 `[依赖]`

---

### 🧱 长期路线图（参考方向，非具体待办）

- **测试覆盖率提升** — 当前 lines 74.88% / branches 59.93%，CI 阈值 lines/statements/functions 70%、branches 55%；可随测试补齐逐步收紧。
- **组件文档持续维护** — `src/components/README.md` 已建立；新增共享组件时同步追加说明。
- **AI 客户端工具扩展** — 已有 4 项新工具（`list_backups` / `run_playbook` / `query_traffic` / `manage_cron`），可继续扩展 hosted-tools 覆盖更多运维场景。

---

### ⚠️ 审计订正（防止重复误报）

> 以下结论由前几轮审计反复确认，避免后续重复列入"待做"。

- **`csrf_token` cookie 不能加 `HttpOnly`** — 走 Double-Submit Cookie 模式，client 必须 `document.cookie` 读 token；加 `HttpOnly` 会直接破坏 CSRF 防护。承载身份的 session cookie 已 `httpOnly: true`，组合已满足 OWASP 推荐。`src/lib/auth/csrf-client.ts` 顶部已加 JSDoc。
- **`effect` / `@electric-sql/pglite*` 不能 `npm remove`** — 两者均为 `prisma@7.8.0` 的 transitive dependency，不在 `package.json` 顶层；验证 `npm ls effect` / `npm ls @electric-sql/pglite`。瘦身需 prisma 主动减少，非项目侧可解。
- **"4 个核心页面缺 PageHeader" 假阳性** — `/ai` 是聊天 UI、`/storage` 只 redirect、`/media` 与 `/image-bed` 已具备 eyebrow/title/description（自定义 hero header），无需补齐。

## 📄 许可
