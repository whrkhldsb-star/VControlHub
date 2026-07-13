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
- **社区推荐** — LinuxServer.io 等第三方应用源实时同步；可用数量以当前源返回结果为准
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
- **部署管理** — 版本导出、最近部署重发、基于部署快照的真实回滚
- **成本追踪** — 资源成本汇总与趋势分析
- **智能运维** — AI 驱动的运维建议与自动诊断

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
| 健康检查     | `/health`          | 服务健康状态                                                   |

---

## 🚀 快速部署

### 前置条件

- **OS** — Debian / Ubuntu 22.04+（root 权限）
- **域名** — 可选（无域名时自动配置 Apache/IP 直连模式）
- **端口** — 对公网仅需 80/443（Web）；3000/3001 分别供 Next.js 与 SSH-WS 在本机回环地址监听，不应直接开放到公网

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

# 2. 运行安装器（自动安装 Node.js 22、发行版 PostgreSQL、Caddy/Apache 等依赖）
sudo APP_DIR=/opt/vcontrolhub /opt/vcontrolhub/deploy/install.sh

# 3. 可选：检查或覆盖安装器自动生成的环境变量，然后重新运行以应用修改
sudoedit /opt/vcontrolhub/.env.local
sudo APP_DIR=/opt/vcontrolhub /opt/vcontrolhub/deploy/install.sh
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
| 功能页面            | 47                                               |
| API 路由文件        | 138                                              |
| 数据模型            | 60                                               |
| UI 组件           | 33                                               |
| 代码行数            | ~180,078（src 扫描）                                 |
| 测试              | 408 文件                                           |
| Docker 应用模板     | 44 (本地) + 社区源实时同步                                |
| i18n            | 212 useI18n() 调用点，78 字典文件                        |
<!-- README_METRICS_END -->

---

## 📋 代码审查与深度审计记录

> 全面复核与修复日期：**2026-07-12**。范围包括 47 个页面、138 个 API 路由、60 个 Prisma 模型，以及认证、RBAC、CSRF、SSH/SFTP、文件一致性、前端浏览器行为、后台任务、部署资产、依赖和文档一致性。

### 修复结论

本轮审查记录的 47 项问题均已处理。质量门禁已经收紧：Lint 不再允许 warning，Prisma 格式检查和 README 指标检查已加入 `npm run verify`。安全方面增加 SFTP home 目录隔离、DNS rebinding 防护、SSE 并发控制和 nonce CSP；可靠性方面增加文件移动事务/补偿、等待式审计写入、前端后台轮询治理和真实浏览器回归测试。

### 已完成修复

| ID | 状态 | 修复内容 |
|---|---|---|
| REV-01 | ✅ | 修复 React ref render 写入；i18n missing key 45→0、zh/en mismatch 1→0；Prisma schema 已格式化。 |
| REV-02 | ✅ | SFTP 上传改为直接消费 `File.stream()`，移除 `arrayBuffer()` 与 `Buffer.from()` 的整文件堆内存复制。 |
| REV-03 | ✅ | 文件移动的主记录与目录子项改为 Prisma 事务；数据库失败时执行 backing object 补偿移动。 |
| REV-04 | ✅ | 新增 `server:sftp:unrestricted` 权限；普通 operator 仅能访问 SSH 用户 home，管理员可显式获得全路径权限。 |
| REV-05 | ✅ | 存储直连在实际 fetch 前重新解析 DNS，并拒绝 loopback、私网、link-local、metadata 和其他保留地址。 |
| REV-06 | ✅ | 监控 SSE 增加每用户最多 3 条活跃连接、30 分钟最长连接时间，并在 abort/cancel 时可靠释放计数和 timer。 |
| REV-07 | ✅ | 生产脚本 CSP 使用逐请求 nonce + `strict-dynamic`，移除脚本 `'unsafe-inline'` 与 `'unsafe-eval'`；`object-src` 收紧为 `none`。 |
| REV-08 | ✅ | `auditUserAction`/`auditSystemAction` 改为 Promise，业务调用点统一 `await`，请求结束前完成审计落库尝试；失败提升为 error 日志。 |
| REV-09 | ✅ | 新增 SFTP 路径隔离、DNS rebinding、CSP nonce 和文件移动事务回归测试；route catalog 继续对全部 138 条 API 的 guard mode 做全量检查。 |
| REV-10 | ✅ | RBAC 扫描器支持动态 options 与 manual guard；当前 54 个权限、138 条 API、47 个页面的 drift 为 0。 |
| REV-11 | ✅ | Prisma schema 已统一格式化，`prisma format --check` 加入完整门禁。 |
| REV-12 | ✅ | 清理全部 61 个 Lint warning，包括死代码、无用导入、Hook 依赖和 effect 状态更新；Lint 使用 `--max-warnings=0`。 |
| REV-13 | ✅ | 修复重置密码与下载清理弹窗的点击冒泡，内容区交互不再误触遮罩关闭。 |
| REV-14 | ✅ | 补齐部署导出、Docker 资源、Playbook、系统导入、团队成员和密码重置表单的可访问名称；字段静态告警由 17 降至 7，剩余项均为通用透传组件或注释误报。 |
| REV-15 | ✅ | 新增可见性感知定时器；流量、Docker、下载、健康、通知和服务器自动探测在后台标签页暂停，恢复可见时立即同步，且继续防止重叠请求。 |
| REV-16 | ✅ | 监控 SSE fallback 防止重复 interval，并随页面可见性暂停；团队切换移除延迟整页 reload，改为本地状态同步、数据刷新和 Router refresh。 |
| REV-17 | ✅ | 移除会在 React selective hydration 期间修改未完成节点的 DOM 翻译桥；完整 i18n 字典继续作为唯一翻译来源，消除登录页 hydration mismatch。 |
| REV-18 | ✅ | PWA 首次安装不再因 `controllerchange` 无条件刷新页面；只有用户明确确认更新后才刷新，修复首次登录成功后被竞态拉回登录页。 |
| REV-19 | ✅ | Tailwind v4 class discovery 限定到 `src/`；Playwright trace/report 移至隐藏产物目录并加入忽略规则，避免失败报告中的 HTML 片段破坏 CSS 编译。 |
| REV-20 | ✅ | 修复客户端 branding 环境变量未被 Next.js 内联导致的中英文 hydration mismatch；重构认证 E2E 会话假设，并新增核心页面、移动端溢出、键盘登录、5xx 与 pageerror 浏览器测试。 |
| REV-21 | ✅ | 新增统一 `ConfirmDialog`，迁移 Playbook、SSH 文件、备份计划、定时任务和团队空间的危险操作确认流程；集中复用焦点锁定、Esc、遮罩、忙碌态与危险按钮样式，并补充组件回归测试。 |
| REV-22 | ✅ | 服务器监控卡迁移到可见性感知轮询；快捷服务的目录合并、搜索、排序、分组、推荐项和状态汇总抽成可缓存纯函数，降低主客户端组件职责并补充派生模型测试。 |
| REV-23 | ✅ | 改进无障碍审计器对 JSX runtime text、通用透传组件和源码注释的识别，消除 45 个按钮与 7 个字段误报；当前 306 个表单字段全部有可访问名称，icon-only button 可信告警为 0。 |
| REV-24 | ✅ | 修复生产运行中覆盖 `.next` 导致 Client Manifest 与进程内模块映射失配的整站 500；自定义 HTTP server 现在可在 SIGTERM 下约 1 秒优雅退出，`deploy.sh` 改为停服务后构建且失败自动恢复，构建入口会阻止对当前运行目录执行危险 live build。生产实例随后完成 Chromium 真实登录、核心页面、移动端、键盘、5xx 与 pageerror 回归。 |
| REV-25 | ✅ | 修复公告增删改后页面缓存与客户端状态不同步、模板可选描述发送 `null`、备份计划动态路由参数读取错误、登录快慢限流窗口共用 bucket 等真实 CRUD 问题。 |
| REV-26 | ✅ | 修复文件夹创建与上传完成时 `router.refresh()` 和 SPA 目录刷新竞争，以及内联回调引用变化造成成功 effect 重复执行；分享结果增加关闭入口，公开分享空路径不再发送无效 `path=`。 |
| REV-27 | ✅ | 图片上传到 LOCAL/SFTP 后同步创建或恢复 `FileEntry`，普通上传和分片上传统一打通“写入存储 → 文件索引 → 媒体扫描”；失败时补偿图床文件、存储副本和数据库记录。 |
| REV-28 | ✅ | API 限流默认按 pathname 隔离 bucket，避免上传、扫描、收藏、标签与发布等不同正常操作互相消耗额度并误报 429。 |
| REV-29 | ✅ | 修复图床桌面悬浮操作层拦截图片预览点击，补齐空白区预览行为，并将“添加”“删除”等模糊按钮名称改为“添加标签”“删除图片”。 |
| REV-30 | ✅ | 修复图床删除对新旧 `relativePath` 存储格式不兼容导致的 502；已认证图片列表改为不复用陈旧缓存，删除成功后卡片立即从界面消失。 |
| REV-31 | ✅ | 媒体上传、扫描、搜索、收藏、标签、动态详情、发布外链、图床搜索、预览、复制和删除已在生产 Chromium 中逐步真实操作通过。 |
| REV-32 | ✅ | 增加真实 CRUD、文件管理、媒体图床和剩余用户工作流 Playwright 套件，覆盖设置标签、偏好持久化、通知已读、流量、Docker 日志、快捷服务、QA 详情、审计、AI/AI Ops、下载任务及服务器探测。 |
| REV-33 | ✅ | AI 助手页面补齐唯一一级标题，修复页面从 `h2` 开始的语义层级缺口，改善屏幕阅读器和页面大纲导航。 |
| REV-34 | ✅ | Webhook 测试与真实告警发送同时检查安全 fetch 的结构化失败和 HTTP 状态，不再把 DNS/SSRF 拒绝、网络失败或 HTTP 5xx 误报为成功。 |
| REV-35 | ✅ | 备份恢复 worker 不再自行伪造 `RESTORE` 确认；缺失或篡改确认字段时 fail closed，执行器仍保留独立二次校验。 |
| REV-36 | ✅ | 备份恢复前强制重新计算并比对 SHA-256；缺少校验值或归档被修改时拒绝执行。 |
| REV-37 | ✅ | SMTP 增加连接、问候和 socket 超时，Telegram 增加 15 秒请求超时，防止外部服务异常时长期占用请求或 worker。 |
| REV-38 | ✅ | Docker 操作失败返回真实非 2xx 状态；QuickService 仅复用操作和删除数据选项完全一致的任务，不同操作改为冲突拒绝。 |
| REV-39 | ✅ | 完成源码与测试瘦身审计：移除 6 个全仓零引用组件/工具、零引用 `clsx` 与冗余 DOMPurify 类型包、重复 Tab CSS 和空的 skipped 测试；保留跨模块安全契约测试，完整套件无 skipped。 |
| REV-40 | ✅ | 升级共享前端 primitives：移除整包 `use client` 边界和 14 个未使用导出，重写为 6 个真实使用、格式清晰且 server-safe 的展示/表单组件；删除失效 CSS hooks，并补充组件边界规范。 |
| REV-41 | ✅ | 基于重复代码扫描继续瘦身：删除已无生产调用、仅由自身测试保活的旧 SSH Terminal Modal/SidePanel，实现统一到多标签 TerminalPanel；合并 `/` 与 `/dashboard` 的重复查询和渲染为单一 DashboardContent。 |
| REV-42 | ✅ | 合并代码片段新建/编辑弹窗为单一模式化 SnippetModal，共享字段、标签解析、提交状态和错误处理；POST/PATCH、初始值与成功提示继续按模式隔离，减少约 160 行重复代码。 |
| REV-43 | ✅ | Docker 容器与资源 API 统一复用 Unix Socket 客户端；E2E trusted session 强制数据库为回环地址；备份恢复和 QuickService 长任务增加周期 lease heartbeat，降低超时后重复领取风险。 |
| REV-44 | ✅ | AI action 执行增加数据库 optimistic CAS claim 和已执行拒绝，避免并发重复执行；所有 `withApiRoute` 响应增加 `x-request-id`；新增 quick/merge/deploy/nightly 四层测试命令。 |
| REV-45 | ✅ | Monitoring JSON 与 SSE 路由统一复用单一 `/proc` 指标采集器，消除 CPU、内存、磁盘、网络、Top 进程和 TCP 连接的双份实现。 |
| REV-46 | ✅ | SFTP 列表、下载与操作路由统一复用 StorageNode 查询、SFTP 类型校验和 SSH 凭据解析，保留各路由独立的路径、授权和流式资源管理。 |
| REV-47 | ✅ | 修复服务启动后另一构建入口覆盖 `.next` 导致生产静态资产 500：所有 Next build 脚本统一强制运行保护器，未协调的生产构建一律拒绝；`deploy.sh` 增加跨进程 `flock`，仅在持锁且服务停止后授权构建。重新部署后 smoke 25/25、生产 HTML 引用的 15 个 JS/CSS 资产全部 200，Chromium 全页面/桌面/移动端/全局控件真实回归 4/4 通过。 |

### 验证状态（2026-07-11）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 0 errors / 0 warnings |
| `npm run i18n:key-check` | ✅ missing 0 / orphan 0 / zh-en mismatch 0 |
| `npm test` | ✅ 399 files passed；2771 passed / 0 skipped |
| `npm run route:verify` | ✅ 47 pages / 138 API routes / 54 permissions |
| `npm run rbac:audit` | ✅ 0 drift |
| `npx prisma validate` / `npx prisma format --check` | ✅ 通过 |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| `npm run build` / `npm run build:runtime` | ✅ Next.js 生产构建与两个 Node runtime bundle 均通过 |
| Playwright Chromium | ✅ 全部静态页面巡检、桌面导航、390px 移动端、键盘、CRUD、文件/分享、媒体/图床、设置/偏好、通知、Docker、流量、快捷服务、QA、审计、AI、下载及服务器安全探测流程通过；REV-47 部署后探索式生产回归 4/4 通过 |
| `npm run verify:deploy-assets` | ✅ 通过；无 Docker Compose 插件时自动执行离线 YAML/部署契约校验，不再跳过 |
| `npm run docs:check` | ✅ README 指标为最新 |

> “项目规模”的测试文件数量包含 Vitest、Playwright E2E 和其他测试资产；`npm test` 的 400 个文件仅统计 Vitest 实际执行的测试文件，两者口径不同。

> 最后一次完整 `npm run verify` 已通过。Next.js 仍会提示自定义 `/_next/static/*` Cache-Control 可能影响开发模式；Caddy 对同时声明 HTTP/HTTPS 的 Flexible 模式会提示不自动重定向，这是该示例的预期行为。

### 已确认的良好实现

- Session、CSRF、API guard、RBAC service-layer 检查和登录限流已形成多层防护；公开路径和 bearer-token bypass 范围较窄。
- SSH/SFTP 关键连接使用主机密钥校验；存储路径工具普遍采用规范化与根目录边界检查。
- 密码使用 bcrypt，敏感凭据有加密存储路径，分享 token 使用带盐派生；仓库未发现被 Git 跟踪的 `.env`、私钥或数据库文件。
- Prisma schema 大量使用唯一约束、索引和级联策略；原始 SQL 调用使用 Prisma 参数化模板。
- 依赖锁文件存在，生产依赖审计为 0 已知漏洞；部署模板、systemd/Caddy 资产和环境变量占位检查较完整。
- 后台命令、备份、下载和 AI 审批已有 durable job/CAS/worker ownership 等并发保护；本轮还逐层复核了危险操作的前端确认、权限、schema、队列载荷、worker 和执行器边界。

### 2026-07-12 残余深度审计（续）

> 在 REV-01…REV-47 之上，对竞态、审计缺口、假成功路径、webhook SSRF、错误文案和删除一致性做了第二轮落地修复。提交：`113f5a7a`、`d2c2e760` 及后续。

#### 本轮已修复

| ID | 状态 | 内容 |
|---|---|---|
| BE-1 | ✅ | Ticket 状态机 TOCTOU → `updateMany` CAS（期望旧 status） |
| BE-2 | ✅ | Backup void/retry TOCTOU → 仅 PENDING/FAILED 可 void、仅 FAILED 可 retry |
| BE-3 | ✅ | 同备份并发 restore → PostgreSQL session advisory lock + 进行中 restore job 去重 |
| BE-4 | ✅ | Share 下载配额竞态 → `accessCount < maxDownloads` 原子 claim |
| BE-5 | ✅ | Playbook webhook SSRF → schema 语法校验 + `fetchWebhookSafely` 执行路径 |
| BE-6/7 | ✅ | 存储软删/永久删：索引先更新/删除（事务），物理删 best-effort；软删返回 `physicalDeleted` / `needsReconcile` |
| BE-8 | ✅ | Sync job `IDLE/ERROR → RUNNING` CAS claim |
| BE-9/10 | ✅ | 工单创建/评论、命令审批/驳回审计补齐 |
| BE-18/19 | ✅ | downloads notify、quick-service status 的空 `.catch` 改为结构化 warn 日志 |
| 文案 | ✅ | API 粘连英文错误（如 `CreateFailed` / `UsernameAlready exists`）改为可读英文 |
| 审计残留 | ✅ | server batch/gateway、image batch、app-source sync/toggle、media scan/update、storage create/rename/delete/restore/permanent、backup create/offsite/retention |
| BE-20 | ✅ | Share 旧 SHA-256 密码：成功校验后透明升级为 scrypt 并 CAS 回写；新密码只写 scrypt |
| 静默 catch 收紧 | ✅ | auth 改密审计 `await auditUserAction`；downloads/command/scheduled-task/health/vps-backup 等关键路径空 catch 改为结构化 warn |
| BE-21 | ✅ | VPS backup 本地下载路径校验：拒绝 `..`/绝对路径，限制在 `storage/vps-backups/`；删除/下载共用解析 |
| BE-22 | ✅ | VPS backup `PENDING/FAILED → RUNNING` CAS，避免双 worker 同跑 |
| BE-23 | ✅ | AI hosted action `reject` 改为 `updateMany` CAS（含非审批人的 requester 范围） |
| 文档 | ✅ | openapi.json 路由注释修正为 delegated（实际仍 requireAuth） |
| BE-24 | ✅ | VPS backup schedule tick：`findFirst RUNNING` 竞态 → PostgreSQL advisory lock + 过期 lease 回收 |
| BE-25 | ✅ | 命令执行 / 下载 SCP：已 pin 的 `hostKeySha256` 经 ssh2 校验后再连；未 pin 仍 accept-new 引导 |

#### 全量扫描记录（2026-07-12 第三轮）

> 范围：138 个 API 路由、`src/lib` 竞态/路径/SSRF/静默失败、SSH 主机密钥路径。只记录 **HIGH/MEDIUM** 与经确认的产品边界，不重复 BE-1…BE-23 已修项。

##### 扫描方法

| 维度 | 方法 |
|---|---|
| API 鉴权 | 全量 `route.ts` 是否经 `withApiRoute` / 登录专用 / public share |
| IDOR | 动态 `[id]` 路由：权限角色 vs service 层 ownership |
| 竞态 | `status: RUNNING`、`findUnique`+`update` 无 `updateMany`、schedule tick 锁 |
| 路径 | `join/resolve` + 用户可控 path、backup/storage 可移植路径 |
| SSRF | 裸 `fetch(` 是否经安全 URL 断言 |
| 静默失败 | 生产路径 `.catch(() => {})` / 空 `catch {}` |

##### 本轮新发现 → 已修

| ID | 严重度 | 位置 | 问题 | 处理 |
|---|---|---|---|---|
| BE-24 | MEDIUM | `src/lib/backup/vps-backup-schedule-worker.ts` | tick 用「查有无 RUNNING job」非原子，多进程可双 tick | `pg_advisory_lock` + 过期 lease 标记 FAILED |
| BE-25 | HIGH | `command/service-execution.ts`、`downloads/execution.ts` | CLI `StrictHostKeyChecking=accept-new` + 丢弃 known_hosts，**已 pin 指纹未参与校验** | pin 存在时先 ssh2 `hostVerifier` 校验；下载走 sftp；未 pin 保持引导 |

##### 扫描结论：未发现新的 CRITICAL 未修项

| 区域 | 结论 |
|---|---|
| API 无 guard | 仅 login、2FA verify-login、share token（预期）；downloads 为 reexport；openapi 实际 `requireAuth` |
| requireAuth-only 路由 | teams/AI hosted-actions 在 **service 层**做成员/权限；monitoring/status/signout 为预期设计；image file 对非公开图做 owner/`image:read` |
| Job events / operation-tasks | `task:read` 角色可读运维任务流——**有意的运营可见性**，非匿名 IDOR |
| Backup/VPS/AI/Sync CAS | 关键状态机已 CAS 或 advisory lock（含 BE-1…23 + 24） |
| 存储/图床路径 | image `resolveUploadPath` 有 root 边界；share path normalize 拒 `..` |
| direct-access fetch | 先 `assertPublicBaseUrlResolvesPublic` 再 health fetch |
| 裸 fetch 其它 | AI provider / Telegram / aria2 / 客户端 api-client：配置端点或同站，非用户任意 URL |
| 空 catch 残留 | 仅 unlink 清理、ssh stream close 等 best-effort；非业务假成功 |

##### 有意接受 / 待产品决策（写入升级路线，非本次硬修）

| ID | 严重度 | 项 | 说明 |
|---|---|---|---|
| OPEN-1 | LOW–MED | 未 pin 主机的 `accept-new` | 首次连接仍 TOFU；需在 UI 强制完成指纹确认后写入 `hostKeySha256`（已有 probe/审批流） |
| OPEN-2 | LOW | Sync rsync SSH 仍 `accept-new` | 与 BE-25 同族；建议下一轮统一走 `buildSshParamsFromServer` + pin |
| OPEN-3 | LOW | Download 任务状态更新非 CAS | 单 worker 按 taskId 串行执行，重复 claim 风险低；若多 worker 同任务需 CAS |
| OPEN-4 | 产品 | `task:read` 可见他人 job events | 若需多租户硬隔离，改为 createdBy 或管理员-only |
| OPEN-5 | 产品 | Share 旧 SHA 分支 | 透明升级已上线；需报表 + 窗口后删兼容 |
| OPEN-6 | 范围外 | 全浏览器 E2E / DAST / 压测 / 不可逆生产实测 | 见审查边界 |

### 2026-07-12 前端专项扫描

> 范围：约 230 个 `"use client"` 组件、表单、预览 XSS 面、轮询/定时器、密码字段、公开分享 UI。后端 API 扫描见上文；本节约前端。

#### 扫描方法

| 维度 | 方法 |
|---|---|
| XSS | `dangerouslySetInnerHTML` / `innerHTML` / `eval` / markdown 渲染 |
| 敏感信息 | localStorage 键、密码是否进 URL/history |
| 网络 | 客户端 `fetch` vs `csrfFetch`、`.ok` 检查 |
| 状态 | `setInterval` 清理、visibility 轮询、假成功 |
| a11y 基线 | icon button aria、password autocomplete、confirm 对话框 |

#### 已修复

| ID | 严重度 | 内容 |
|---|---|---|
| FE-1 | **HIGH** | 公开分享密码门：原先用 `<a href="...?password=">` 把密码放进 URL（历史/日志/Referer 泄露）。改为 `fetch` + `X-Share-Password` 头下载；API 支持 header，query 仍兼容旧书签 |
| FE-2 | LOW | 用户创建/重置、AI API Key、SSH 密钥口令等密码框补 `autoComplete` |

#### 扫描结论（未发现其它 CRITICAL）

| 区域 | 结论 |
|---|---|
| XSS 预览 | markdown 经 `sanitizeHtml`；代码高亮先 `escapeHtml`；AI markdown 用 React 节点 + escape，外链 `rel=noopener noreferrer` |
| `eval` / `document.write` | 未发现 |
| localStorage | 偏好/主题/SSH 收藏命令等，无 session/token 密钥 |
| `target=_blank` | 未发现缺 `rel` 的问题样本 |
| 轮询 | `useVisibilityInterval` / monitoring SSE fallback 有 cleanup；`auto-probe-context` 的 setInterval 为误报（setter 名） |
| 危险 confirm | 未发现裸 `window.confirm`（已统一 ConfirmDialog 方向） |
| error.tsx | 主要路由段均有 `error.tsx`（约 48 个） |
| 客户端 GET fetch | 预览/搜索/监控等只读路径用 `fetch` 合理；写操作普遍 `csrfFetch` |
| icon-only 按钮 | 启发式 0 个无 aria-label |

#### 有意接受 / 后续（前端）

| ID | 项 | 说明 |
|---|---|---|
| FE-OPEN-1 | 全量视觉/交互 E2E | Chromium 主路径已有 Playwright；非本轮全矩阵 |
| FE-OPEN-2 | 大型 Client 拆分 | 见架构升级路线 P0 |
| FE-OPEN-3 | 部分表单仅 id 无 name 的受控组件 | 走 API JSON，非原生 form POST，可接受 |

### 2026-07-12 前端美化重构（FE-UI）

> 目标：信息架构更直观、全局壳更统一，而不是逐页重写业务逻辑。

| 项 | 内容 |
|---|---|
| 导航 IA | 27 个主入口改为 5 组（总览 / 文件 / 运维 / AI 协作 / 配置）+ 系统管理；侧栏内筛选；分组可折叠 |
| 侧栏视觉 | 更紧凑的链接、活动态左侧 accent 条、账户区卡片化、筛选框 |
| Page shell | `PageHeader` / `Toolbar` / `Section` / `EmptyState` / `StatCard` 视觉升级 |
| globals | 卡片阴影层次、嵌套卡降噪、表格表头/行 hover、`data-toolbar` / `data-input` |
| 移动底栏 | 毛玻璃 + 活动 tab 底色高亮 |
| 图标 | monitoring / cost 独立图标，减少重复 |

下一阶段可继续：关键业务页（servers/files/dashboard）接入 `Toolbar`/`Section`、收敛巨型 client 组件。

### 2026-07-12 前端全站视觉升级（FE-UI Round 2）

| 覆盖面 | 内容 |
|---|---|
| 全局 CSS | 全站面板/输入/表格/嵌套卡/工具栏统一；减少硬编码深色噪声 |
| 公开页 | 登录、2FA、分享页、公开状态、offline、404、route/root error 卡片化与背景统一 |
| 业务页 | API Docs 接入 PageShell/Toolbar；图床/媒体 hero 与 token 化背景；AI 壳背景对齐 |
| 已有壳 | docker/monitoring/traffic/preferences 等已用 PageShell，随全局样式一并受益 |

说明：47 个路由中绝大多数业务页此前已使用 `PageShell`；本轮重点把**全局样式 + 公开页 + 遗漏壳**补齐，使“每个页面都有可见升级”。

##### 补扫确认（防漏项 · 后端）

在第三轮主扫之后又做了一轮**防漏补扫**，结论如下（均不构成新的未记录 CRITICAL）：

| 区域 | 结果 |
|---|---|
| API `route.ts` 138 + downloads 子模块 4 | 无 guard 仅 login / 2FA / share；子模块均 `withApiRoute` |
| Server Actions（`actions*.ts`） | 业务 action 均有 session/权限；`actions.ts` / `actions-helpers` 仅为 barrel/类型 |
| Edge 鉴权 | Next 16 使用 `src/proxy.ts`（非 middleware.ts）：公开路径白名单 + session cookie 形态检查 |
| SSH / 通知 WS | `ssh-ws-proxy` 校验 session JWT + `canUseSshTerminal`；`notification-ws` 校验 token |
| 自定义 `server.ts` | 仅挂 Next + 通知 WS，鉴权在 WS 层 |
| SQL | 仅参数化 `$executeRaw` / `$queryRaw`，**无** `*RawUnsafe` |
| XSS 预览 | `dangerouslySetInnerHTML` 仅 markdown/代码高亮，经 `sanitizeHtml` / `sanitizeHighlight` |
| 空 catch 残留 | unlink / stream close 清理类 |
| 密钥入库 | 仓库仅 `.env.example`，无跟踪私钥/真实 env |
| 已知残留 OPEN | Sync `accept-new`（OPEN-2）、未 pin TOFU（OPEN-1）、download 非 CAS（OPEN-3）等已在上表 |

**结论**：服务端高/中优先级安全与一致性问题已在 BE-1…BE-25 覆盖；前端 FE-1 已修；剩余项均为产品边界、引导路径或范围外验证，**未发现扫描漏掉的新 CRITICAL/HIGH 未修缺陷**。

#### 有意未做 / 待迁移窗口（不要误当“漏修”）

以下项**不是遗忘**，而是需要产品策略、数据迁移窗口或更大架构改动；在完成前保持兼容或接受已知边界：

| 项 | 原因 | 建议路径 |
|---|---|---|
| **旧 Share 密码 SHA-256 兼容** | 历史 `passwordHash` 可能仍是无盐 SHA；立即删除校验会让旧分享链失效 | ✅ 校验成功时透明升级为 `scrypt:salt:hash` 并 CAS 回写；运维窗口后仍可扫描非 scrypt 活跃链接再强制重置/吊销，最后删除 SHA 分支 |
| **前端交互层全量 E2E 矩阵** | 本轮优先服务端竞态/审计/一致性；Playwright 已有主路径但非 Firefox/WebKit 全矩阵 | 继续扩展可逆 CRUD / 文件 / 分享 / 媒体套件；跨浏览器放入 nightly |
| **危险操作跨进程硬锁（全集）** | restore + VPS schedule tick advisory lock 与 job lease 已覆盖关键路径；全站统一 lease 中心仍开放 | 见「持续升级路线」P1 |
| **不可逆生产副作用实测** | 关机、删生产容器、真实全量 restore、密钥轮换、外发通知等未在生产上硬跑 | 隔离环境 + 调用链静态推演 + mock；见「审查边界」 |
| **覆盖率 / DAST / SAST / 压测** | 非本轮交付范围 | `test:coverage`、容器扫描、专用安全扫描、高并发压测单独排期 |
| **Sync CLI SSH 主机密钥 pin** | OPEN-2 | 与 BE-25 对齐 |
| **task:read 多租户收窄** | OPEN-4 | 产品确认后改查询范围 |

#### 验证（全量扫描 + BE-24/25 后）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅（提交前复核） |
| 聚焦 Vitest（command / share / backup / ai hosted 等） | ✅（提交前复核） |
| `npm run build:runtime` + `npx next build --webpack` | ✅（提交前复核） |
| 生产 `vcontrolhub-next` smoke（login / status） | ✅（提交前复核） |

### 审查边界

- 本轮已连接当前生产 PostgreSQL、systemd、Caddy、Docker、已配置服务器探测和下载 worker，并在隔离账号/唯一前缀数据下复测；关机、删除现有容器、安装/卸载真实服务、真实备份恢复、强制 AI 自主执行、密钥轮换和通知外发采用完整调用链静态推演、配置核对及 mock/隔离验证，未对生产资源产生这些不可逆或外部副作用。
- Playwright 已覆盖 Chromium 桌面端、390px 移动端和主要安全可逆流程，但未执行 Firefox/WebKit 跨浏览器矩阵；也未执行 `npm run test:coverage`、容器镜像扫描、DAST、SAST 专用扫描器或高并发压测。
- 当前工作区在本次审查前已有部署模板与 RBAC 报告的未提交修改；本节结论以审查时工作树为准。

### 持续升级路线（2026-07-12）

以下项目是当前架构升级的正式工作清单。只有通过类型检查、完整测试、生产构建、部署 smoke 和真实浏览器复核后，才会从“进行中”调整为“已完成”。

| 优先级 | 状态 | 升级方向 | 验收标准 |
|---|---|---|---|
| P0 | 进行中 | 收敛大型 Client Component，将数据获取、mutation、展示区块和弹窗拆到稳定边界 | 页面行为不变；减少客户端边界与重复状态；桌面/移动浏览器回归通过 |
| P0 | ✅ 阶段性 | 导航信息架构 + 全局页面壳美化 | 侧栏分组/筛选、PageHeader/Toolbar/EmptyState 升级、表格/卡片/移动底栏统一；提交见 FE-UI 记录 |
| P0 | 进行中 | 收敛 `globals.css` 历史兼容规则，迁移到明确的 primitives 与 `data-*` hooks | 删除零命中/重复选择器；深浅主题、focus、dialog、表格和卡片视觉回归通过 |
| P1 | 进行中 | 合并文件动作的重复核心 | Docker、Monitoring 与 SFTP 连接层已统一；继续收敛移动/重命名及目录操作 |
| P1 | 进行中 | 强化危险操作跨进程锁和崩溃恢复 | lease、AI CAS、backup restore / VPS schedule tick advisory lock 已完成；继续服务级统一 lease 中心 |
| P1 | 进行中 | 正式化 E2E 隔离账号与本机数据库会话保护 | 已拒绝非回环数据库；继续自动创建/清理隔离账号并移除管理员依赖 |
| P1 | 进行中 | Share 密码哈希迁移收口 | ✅ 透明升级已上线；剩余：活跃旧哈希扫描报表 + 窗口结束后移除 SHA 校验分支 |
| P1 | 进行中 | SSH 主机密钥 pin 全路径收口 | ✅ 命令执行 + 下载 pin 校验；剩余 Sync rsync CLI（OPEN-2）与强制首次 TOFU 入库 |
| P2 | 进行中 | 增加 Web Vitals、API 延迟、队列积压、WebSocket、轮询和通知投递可观测性 | request ID 已覆盖 guarded API；继续补充指标查询与前端关联 |

> 当前功能优先保持稳定，不以引入大型状态管理框架或无收益的文件拆分为“升级”；优化必须带来更小的重复面、更清晰的所有权或更可靠的运行时行为。

---

## 📄 许可
