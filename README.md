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
- **部署管理** — 版本导出 + 回滚支持

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
| 部署 | `/deployments` | 应用部署运行记录、版本导出与回滚支持 |
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
| 代码量 | **~44,700 行** TypeScript/TSX | — |

---

## 📁 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router (35 页面 + 66 API)
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
| 功能页面 | 37 |
| API 端点 | 74 |
| 数据模型 | 45 |
| UI 组件 | 18 |
| 代码行数 | ~77,700（src 扫描） |
| Docker 应用模板 | 44 (本地) + 187 (社区) |

---

## 🔎 当前可用性与功能完整性状态（2026-06-04）

> 当前重点已经从“页面是否能打开”推进到“按钮是否真的有副作用、设置项是否真的生效、后台任务是否真的会跑、安装脚本是否能支撑 fresh install”。以下状态来自生产修复、单元测试、构建和 smoke-test 的收尾结果。

### 已完成的关键闭环

- [x] **前后端枚举一致性修复** — 公告类型创建/编辑表单发送 `critical` 但 API 只接受 `urgent`，导致"严重/紧急"级别公告完全无法创建；已统一为 `urgent`。快捷服务应用源预设 URL 从 `example.com` 占位符改为空值，避免误导用户同步失败。
- [x] **片段所有权校验** — 代码片段的编辑和删除操作现在校验操作者身份：只有创建者或拥有 `role:manage` 权限的管理员可以修改/删除，修复了任意用户可改删他人片段的 IDOR 问题。
- [x] **强制改密拦截** — `requireSession` 中增加 `mustChangePassword` 检测，管理员强制重置密码后用户首次登录会自动跳转改密页。
- [x] **权限门控完善** — 用户管理页面的创建/权限配置/禁用按钮现在受 `user:manage` 权限控制；命令模板列表 GET 权限从 `command:create` 修正为 `command:read`。
- [x] **分享链路可用** — `/shares` 生成的 `/share/[token]` 已有公开落地页；页面只读预览不增加下载计数，下载仍走 `/api/share/[token]` 计数端点。
- [x] **设置项真实生效** — `session.timeout` 会影响普通登录 session TTL；密码复杂度设置会约束改密、创建用户和重置密码。
- [x] **后台功能不再只停留在 UI** — 定时任务 worker 随服务启动，按到期时间触发命令请求并记录运行结果；告警评估 worker 随服务启动并周期检查规则。
- [x] **下载中心批量语义补齐** — HTTP/HTTPS 批量下载会为每个 URL 创建独立任务；磁力/BT 与普通 URL 混合批量会明确拒绝，避免只下载第一项。
- [x] **表单字段不再丢失** — 代码片段创建/编辑支持描述、标签和私有状态；分享创建后刷新列表；公告创建支持置顶/发布字段。
- [x] **工单更新更完整** — 状态、负责人、优先级可以一起更新，避免 UI 有字段但 API 丢弃。
- [x] **一键安装脚本已增强** — 无域名安装进入 Apache/IP 直连路径；`APP_SLUG` 可带短横线，默认 PostgreSQL 用户/库名会安全转换为下划线标识符；部署资产校验进入 `npm run verify`。

### 目前仍存在的问题 / 使用边界

- [ ] **`deploy/smoke-test.sh` 仍偏 systemd 本机部署假设。** 对外部数据库、Compose、自定义反代、纯 HTTP 黑盒部署还不够友好，后续应拆成“本机 systemd 检查”和“公网 HTTP 检查”。
- [ ] **快捷服务的一键更新仍未完善。** 当前更偏安装/管理，后续需要 Docker image pull、容器重建、配置 diff、失败回滚和更新日志。
- [ ] **备份策略仍偏手动。** 已有备份/恢复脚本，但还缺 UI 化定时备份、异地备份、恢复演练和备份大小/保留策略监控。
- [ ] **文件管理还缺完整编辑体验。** 浏览/上传/下载/预览可用，但在线编辑、保存前 diff、保存后可选重载服务仍是下一阶段。
- [ ] **通知渠道还需产品化配置。** 站内通知和告警基础能力可用，Telegram/邮件/Webhook 等外部渠道需要更明确的配置 UI、测试发送和重试队列。
- [ ] **移动端仍是次优体验。** 主要流程面向桌面管理台，手机端需要专门的导航、触摸操作和危险操作确认优化。

---

## 🗺️ 下一步升级方向

### P0 — 收尾质量门禁 / 安装可信度
- [x] 一键安装 fresh install 关键路径：环境变量生成、反向代理分支、PostgreSQL 标识符、runtime bundle、systemd 模板。
- [x] 核心质量门禁：typecheck、lint、测试、Next build、runtime build、部署资产校验。
- [ ] 将 smoke-test 拆分为 `smoke:systemd` / `smoke:http`，减少对本机服务名、PostgreSQL 本机实例和中文文案的硬编码。
- [ ] 增加 installer fakeroot/dry-run 回归脚本，覆盖域名/Caddy、无域名/Apache、`SKIP_PACKAGES=1`、`DESTDIR` 四类分支。

### P1 — 功能设置真实可用
- [x] 会话超时、密码策略、定时任务、告警规则、批量下载、工单优先级、snippet 元数据等“有 UI 但无真实效果/效果不完整”的问题已补齐。
- [ ] 系统设置页继续补齐说明文案、即时验证、保存后生效范围提示（是否需重登/重启/等待 worker 下一轮）。
- [ ] 定时任务增强：Cron 可视化编辑、下一次运行时间预览、失败重试、执行日志搜索。
- [ ] 告警增强：静默期、通知渠道选择、测试发送、失败重试和告警历史趋势。

### P2 — 用户体验和可运营性
- [ ] 快捷服务一键更新：pull/recreate/healthcheck/rollback/log。
- [ ] 在线文件编辑器：文本编辑、差异预览、保存确认、权限边界。
- [ ] 备份策略管理：定时备份、异地备份、恢复验证、保留策略。
- [ ] 操作回滚：关键文件/配置/部署操作提供 undo 或恢复点。
- [ ] 仪表盘自定义：拖拽卡片、指标选择、时间范围筛选。
- [ ] 移动端适配：底部导航、触摸友好控件、危险操作二次确认。

### P3 — 长期愿景
- [ ] 自动化工作流（Playbook）：条件触发、告警联动、步骤编排。
- [ ] 多租户/团队空间：资源隔离、配额管理、权限继承。
- [ ] 成本追踪：VPS 费用、带宽/存储用量、月度报告。
- [ ] 智能运维 AI：主动诊断建议、异常预测、自动修复建议。
- [ ] PWA 离线支持和集成市场。

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
