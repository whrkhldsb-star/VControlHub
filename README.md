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
- **部署管理** — 版本导出、最近部署重发、基于部署快照的真实回滚
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
| 框架     | Next.js (App Router)                        | 16.2.10  |
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
│   ├── app/                    # Next.js App Router (47 页面 + 138 API)
│   │   ├── api/                # API Routes (RESTful)
│   │   ├── servers/            # VPS 管理
│   │   ├── files/              # 文件管理
│   │   ├── quick-services/     # 应用商店
│   │   ├── monitoring/         # 监控面板
│   │   ├── ai/                 # AI 助手
│   │   └── ...                 # 其他功能模块
│   ├── components/             # 共享 UI 组件 (36 个)
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

<!-- README_METRICS_START -->
| 指标            | 数量                                             |
| --------------- | ------------------------------------------------ |
| 功能页面            | 47                                               |
| API 路由文件        | 138                                              |
| 数据模型            | 60                                               |
| UI 组件           | 37                                               |
| 代码行数            | ~181,691（src 扫描）                                 |
| 测试              | 403 文件                                           |
| Docker 应用模板     | 44 (本地) + 社区源实时同步                                |
| i18n            | 216 useI18n() 调用点，78 字典文件                        |
<!-- README_METRICS_END -->

---

## 📋 代码审查与深度审计记录

> 全面复核与修复日期：**2026-07-10**。范围包括 47 个页面、138 个 API 路由、60 个 Prisma 模型，以及认证、RBAC、CSRF、SSH/SFTP、文件一致性、后台任务、部署资产、依赖和文档一致性。

### 修复结论

本轮审查记录的 23 项问题均已处理。质量门禁已经收紧：Lint 不再允许 warning，Prisma 格式检查和 README 指标检查已加入 `npm run verify`。安全方面增加 SFTP home 目录隔离、DNS rebinding 防护、SSE 并发控制和 nonce CSP；可靠性方面增加文件移动事务/补偿、等待式审计写入、前端后台轮询治理和真实浏览器回归测试。

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

### 验证状态（2026-07-10）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 0 errors / 0 warnings |
| `npm run i18n:key-check` | ✅ missing 0 / orphan 0 / zh-en mismatch 0 |
| `npm test` | ✅ 399 files passed；2771 passed / 1 skipped |
| `npm run route:verify` | ✅ 47 pages / 138 API routes / 54 permissions |
| `npm run rbac:audit` | ✅ 0 drift |
| `npx prisma validate` / `npx prisma format --check` | ✅ 通过 |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| `npm run build` / `npm run build:runtime` | ✅ Next.js 生产构建与两个 Node runtime bundle 均通过 |
| Playwright Chromium | ✅ 登录与公开页面、7 个核心受保护页面、390px 移动端、键盘操作、HTTP 5xx 与浏览器异常检查通过 |
| `npm run verify:deploy-assets` | ✅ 通过；无 Docker Compose 插件时自动执行离线 YAML/部署契约校验，不再跳过 |
| `npm run docs:check` | ✅ README 指标为最新 |

> 最后一次完整 `npm run verify` 已通过。Next.js 仍会提示自定义 `/_next/static/*` Cache-Control 可能影响开发模式；Caddy 对同时声明 HTTP/HTTPS 的 Flexible 模式会提示不自动重定向，这是该示例的预期行为。

### 已确认的良好实现

- Session、CSRF、API guard、RBAC service-layer 检查和登录限流已形成多层防护；公开路径和 bearer-token bypass 范围较窄。
- SSH/SFTP 关键连接使用主机密钥校验；存储路径工具普遍采用规范化与根目录边界检查。
- 密码使用 bcrypt，敏感凭据有加密存储路径，分享 token 使用带盐派生；仓库未发现被 Git 跟踪的 `.env`、私钥或数据库文件。
- Prisma schema 大量使用唯一约束、索引和级联策略；原始 SQL 调用使用 Prisma 参数化模板。
- 依赖锁文件存在，生产依赖审计为 0 已知漏洞；部署模板、systemd/Caddy 资产和环境变量占位检查较完整。
- 后台命令、备份、下载和 AI 审批已有 durable job/CAS/worker ownership 等并发保护，测试总量充足。

### 审查边界

- 未连接真实生产数据库、SSH 主机、S3、Aria2、Caddy/Apache 或邮件/Telegram 服务，因此没有验证真实灾备恢复、密钥轮换、网络隔离和第三方故障行为。
- 未执行 Playwright 浏览器 E2E、`npm run test:coverage`、容器镜像扫描、DAST、SAST 专用扫描器或高并发压测。
- 当前工作区在本次审查前已有部署模板与 RBAC 报告的未提交修改；本节结论以审查时工作树为准。

---

## 📄 许可
