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
| 功能页面 | 35 |
| API 端点 | 66 |
| 数据模型 | 43 |
| UI 组件 | 18 |
| 代码行数 | ~44,700 |
| Docker 应用模板 | 44 (本地) + 187 (社区) |

---

## 🗺️ 路线图

> 基于实际测试和用户反馈调整优先级。✅ 标注已修复项。

### P0 — 阻塞性 Bug 修复
- [x] CSRF 表单提交修复 — 部署/备份页面 `<form>` 提交被 middleware 拦截 403，改用 `csrfFetch`
- [x] 服务器重复添加检测 — 去重逻辑只查启用节点，已改为全量检查
- [ ] Docker 环境检测 — 快捷服务页面无 Docker 时应给出安装引导而非静默失败
- [ ] 首次登录密码一致性 — 安装后 admin 初始密码与 `.env.local` 不匹配，需确认 seed 逻辑
- [ ] Session 有效期优化 — 测试中频繁跳转登录页，建议延长或增加记住登录选项

### P1 — 核心体验提升
- [x] 部署页面完整流程 — 模板选择 → 变量填写 → VPS 勾选 → 审批提交（csrfFetch 重写）
- [x] 备份页面表单修复 — 同 CSRF 问题，已改为 csrfFetch
- [ ] SSH 多会话 — 分屏 + 多 Tab + 历史命令搜索
- [ ] 在线文件编辑器 — 浏览器内编辑配置文件，保存后可选自动部署
- [ ] 文件搜索 — 按名称 / 内容 / 大小 / 日期搜索
- [ ] 告警外部推送 — Telegram Bot / 邮件 Webhook 已有基础，需完善配置 UI 和重试
- [ ] 定时任务增强 — Cron 可视化编辑 + 执行日志搜索 + 失败重试

### P2 — 功能完善
- [ ] 快捷服务一键更新 — Docker 镜像 pull + 容器重建 + 更新日志
- [ ] 备份策略管理 — 定时备份 + 异地备份 + 恢复验证 + 备份大小监控
- [ ] 操作回滚 — 关键操作（文件删除、配置修改）一键 undo
- [ ] 仪表盘自定义 — 拖拽卡片 + 指标选择 + 时间范围筛选
- [ ] 全局搜索 — 跨模块搜索（文件、命令、日志、用户）
- [ ] 移动端适配优化 — 底部导航 + 触摸手势 + 关键操作可用

### P3 — 长期愿景
- [ ] 自动化工作流 (Playbook) — 条件触发 + 告警联动 + 步骤编排
- [ ] 多租户 / 团队空间 — 资源隔离 + 配额管理 + 权限继承
- [ ] 成本追踪 — VPS 费用 + 带宽/存储用量 + 月度报告
- [ ] 智能运维 AI — 主动诊断建议 + 异常预测 + 自动修复
- [ ] PWA 离线支持 — Service Worker + 关键操作离线可用
- [ ] 集成市场 — 通知渠道 + 监控 Agent + CI/CD 一键接入

---

## 📄 许可

私有项目 — 未经授权不得使用、复制或分发。
