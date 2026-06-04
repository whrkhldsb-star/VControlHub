# VControlHub 新 VPS 部署指南

本文档用于把 VPS 管理 + 分布式云盘平台部署到任意干净 VPS。所有敏感值请只写入目标机器的 `.env.local`，不要提交到仓库。

## 1. 系统依赖

推荐 Ubuntu/Debian：

```bash
sudo apt-get update
sudo apt-get install -y curl git build-essential openssh-client postgresql postgresql-contrib caddy
# 如需密码方式 SSH 执行命令，再安装：
sudo apt-get install -y sshpass
```

安装 Node.js 22 LTS 或更新版本，并确认：

```bash
node -v
npm -v
```

## 2. 获取代码与安装依赖

```bash
git clone https://github.com/whrkhldsb-star/VControlHub.git /opt/vcontrolhub
cd /opt/vcontrolhub
npm ci
```

## 3. 初始化 PostgreSQL

示例命令（请替换密码）：

```bash
sudo -u postgres createuser vcontrolhub || true
sudo -u postgres createdb vcontrolhub -O vcontrolhub || true
sudo -u postgres psql -c "ALTER USER vcontrolhub WITH PASSWORD '<CHANGE_ME_DB_PASSWORD>';"
```

## 4. 配置环境变量

```bash
cp .env.example .env.local
chmod 600 .env.local
$EDITOR .env.local
```

必须替换：

- `DATABASE_URL`：目标 VPS 的 PostgreSQL 地址。
- `AUTH_SESSION_SECRET`：用 `openssl rand -base64 48` 生成。
- `ADMIN_INITIAL_PASSWORD`：首次 seed 创建管理员用的一次性强密码。
- `NEXT_PUBLIC_APP_PUBLIC_LABEL`：部署域名或站点名。

生产环境保持 demo fallback 全部为 `false`。

## 5. Prisma 与初始化数据

Prisma 7 本项目使用 `prisma.config.ts` 读取 `DATABASE_URL`，执行命令前请加载 `.env.local`：

```bash
set -a; . ./.env.local; set +a
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

`prisma:seed` 会创建/更新权限、角色和初始管理员；再次执行不会覆盖已修改过的管理员密码。

## 6. 构建与启动

```bash
npm run build
npm run build:runtime
HOSTNAME=127.0.0.1 PORT=3000 npm run start
```

SSH WebSocket 代理另启一个进程：

```bash
SSH_WS_HOST=127.0.0.1 SSH_WS_PORT=3001 npm run start:ssh-ws
```

生产建议使用 `deploy/systemd/` 下模板创建 systemd 服务。

## 7. 反向代理

参考 `deploy/Caddyfile.example`，将域名替换为目标域名。基本路由：

- `/` → Next.js `127.0.0.1:3000`
- `/ssh` → SSH WebSocket proxy `127.0.0.1:3001`
- 可选 `/files-proxy` → AList
- 可选 `/emby`、`/web` → Emby

## 8. 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run build:runtime
curl -I http://127.0.0.1:3000/login
```

浏览器访问你的域名，登录后先进入“修改密码”更换初始密码，再添加 SSH 密钥、VPS 节点和存储节点。

## 9. 可移植性注意事项

- 不要硬编码当前域名、仓库路径或凭据；通过 `.env.local` 和 systemd 环境文件配置。
- 每台 VPS 的本地存储目录需提前创建并授权给运行用户。
- 远端文件下载/流式访问优先从目标 VPS 直连用户；控制节点只保存必要元数据。
- 生产禁用 demo fallback；数据库不可用时应失败并告警，而不是回落到演示数据。
