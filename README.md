# VPS 统一管控平台 + 分布式云盘

统一的 VPS 管理系统，集成 SSH 远程操作、审批流、分布式云盘和媒体浏览功能。

## ✨ 功能

- **VPS 管理** — 添加/管理多台 VPS 节点，SSH 密钥认证
- **SSH 远程终端** — 浏览器内 WebSocket 终端，安全连接任意节点
- **审批流执行** — 敏感操作需要管理员审批后才执行
- **分布式云盘** — 挂载多节点存储，统一浏览/下载/上传
- **媒体浏览** — 在线预览图片、视频、音频和文档
- **下载中心** — 管理下载任务（Aria2 集成）
- **权限管理** — 用户角色、操作权限、存储配额
- **告警规则** — 自定义监控告警
- **API Token** — 外部集成 Token 管理
- **AI 助手** — 内置 AI 对话助手

## 🚀 一键部署

### 前置条件

- Debian/Ubuntu 22.04+ 服务器（root 权限）
- 一个域名（可选，没有则不配 Caddy）

### 快速安装（3 步）

```bash
# 1. 克隆代码到目标服务器
git clone <your-repo-url> /opt/whrkhldsb

# 2. 首次部署（会生成 .env.local 并提示编辑）
sudo DOMAIN=your.example.com APP_DIR=/opt/whrkhldsb /opt/whrkhldsb/deploy/install.sh

# 3. 编辑环境变量后再次运行
sudoedit /opt/whrkhldsb/.env.local  # 填写数据库、密钥、域名等
sudo DOMAIN=your.example.com APP_DIR=/opt/whrkhldsb /opt/whrkhldsb/deploy/install.sh
```

> 首次运行会自动安装 Node.js 22、PostgreSQL、Caddy 等依赖，然后构建应用并启动 systemd 服务。

### 自定义品牌部署

```bash
sudo APP_NAME="MyCloud" APP_SLUG=mycloud SITE_NAME="My Cloud Platform" \
  DOMAIN=cloud.example.com APP_DIR=/opt/mycloud \
  /opt/mycloud/deploy/install.sh
```

### 压缩包离线部署

```bash
# 在当前服务器打包
./deploy/package.sh  # 输出到 dist/

# 传到新服务器后
tar -xzf whrkhldsb-release-*.tar.gz
cd whrkhldsb-release
sudo DOMAIN=your.example.com APP_DIR=/opt/whrkhldsb ./install.sh
```

更多部署方式（Git 仓库部署、rsync 同步等）详见 [deploy/README.md](deploy/README.md)。

## ⚙️ 技术栈

- **前端** — Next.js 15 (App Router) + React 19 + Tailwind CSS
- **后端** — Next.js Server Actions + API Routes
- **数据库** — PostgreSQL + Prisma 7
- **认证** — lucia-auth + bcrypt
- **SSH** — ssh2 + WebSocket 代理
- **下载** — Aria2 JSON-RPC
- **反向代理** — Caddy (自动 HTTPS)
- **进程管理** — systemd

## 📁 项目结构

```
├── src/
│   ├── app/           # Next.js App Router 页面
│   ├── components/    # 共享 UI 组件
│   └── lib/           # 业务逻辑和工具
├── deploy/            # 部署脚本和配置模板
│   ├── install.sh     # 一键安装/升级
│   ├── upgrade.sh     # 升级（含备份+自检）
│   ├── package.sh     # 打发布压缩包
│   ├── check.sh       # 部署健康检查
│   ├── preflight.sh   # 部署前校验
│   └── backup.sh      # 数据库备份
├── scripts/           # 运维脚本
├── prisma/            # 数据库 Schema 和迁移
└── public/            # 静态资源
```

## 🔧 开发

```bash
# 安装依赖
npm ci

# 开发模式
npm run dev

# 代码检查
npm run lint && npm run typecheck

# 运行测试
npm test

# 构建
npm run build
```

## 🔒 安全

- 生产环境自动拒绝 demo/seed 环境变量
- `.env.local` 不入库，部署脚本校验占位值
- SSH 使用密钥认证，不存储明文密码
- Session 密钥至少 32 字符
- Aria2 配置限定项目端口，不使用 /tmp

## 📄 许可

私有项目
