# VControlHub 新 VPS 部署指南

本文档用于把 VPS 管理 + 分布式云盘平台部署到任意干净 VPS。所有敏感值请只写入目标机器的 `.env.local`，不要提交到仓库。

## 1. 系统依赖

推荐 Ubuntu/Debian：

```bash
sudo apt-get update
sudo apt-get install -y curl git build-essential openssh-client rsync iproute2 aria2 postgresql postgresql-contrib caddy
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
git clone https://github.com/whrkhldsb-star/VControlHub.git /opt/VControlHub
cd /opt/VControlHub
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
VCONTROLHUB_ALLOW_BUILD=1 npm run build
npm run build:runtime
NODE_ENV=production NEXT_HOST=127.0.0.1 PORT=3000 npm run start
```

`npm run build` 默认会拒绝执行：它先检查本机的 `vcontrolhub-next.service`，避免在正在提供服务的目录上直接覆盖 `.next`。首次手动安装时这个服务还不存在，所以用 `VCONTROLHUB_ALLOW_BUILD=1` 明确放行。服务运行起来之后不要再这样构建，更新请用 `sudo bash deploy.sh`（它在独立目录里构建，再切换）。

SSH WebSocket 代理另启一个进程：

```bash
SSH_WS_HOST=127.0.0.1 SSH_WS_PORT=3001 npm run start:ssh-ws
```

生产建议使用 `deploy/systemd/` 下模板创建 systemd 服务。

## 7. 反向代理

参考 `deploy/Caddyfile.example`，将域名替换为目标域名。基本路由：

- `/` → Next.js `127.0.0.1:3000`
- `/ssh` → SSH WebSocket proxy `127.0.0.1:3001`
- `/rdp` → 同一 SSH WebSocket proxy `127.0.0.1:3001`（Windows 远程桌面）
- 可选 `/direct` → 本机存储直连网关 `127.0.0.1:31888`
- 可选 `/files-proxy` → AList
- 可选 `/emby`、`/web` → Emby

`deploy/install.sh` 与 `deploy/upgrade.sh` 每次都按模板重写整个 `/etc/caddy/Caddyfile`，并在同目录保留最近 5 份 `Caddyfile.bak.<时间>`。手工加的规则应同步到模板，否则升级后需从备份恢复。

## 8. 验证

```bash
npm run typecheck
npm run lint
npm test
curl -I http://127.0.0.1:3000/login
```

服务已经在运行时，不要为了验证再执行 `npm run build`：构建会覆盖正在使用的 `.next`。

浏览器访问你的域名，登录后先进入“修改密码”更换初始密码，再添加 SSH 密钥、VPS 节点和存储节点。

## 9. 可移植性注意事项

- 不要硬编码当前域名、仓库路径或凭据；通过 `.env.local` 和 systemd 环境文件配置。
- 每台 VPS 的本地存储目录需提前创建并授权给运行用户。
- 远端文件下载/流式访问优先从目标 VPS 直连用户；控制节点只保存必要元数据。
- 生产禁用 demo fallback；数据库不可用时应失败并告警，而不是回落到演示数据。

## 10. 安全边界：应用用户与 Docker

- 安装器把应用用户加入 `docker` 组（`deploy/install.sh` 的 `usermod -aG docker`），快捷服务、Docker 页和 Compose 项目都靠它调用本机 dockerd。**能访问 `/var/run/docker.sock` 就等价于宿主 root**：一旦 Web/worker 进程被远程执行代码，`docker run --privileged -v /:/host` 可以读写整台宿主（含 `.env.runtime`、PostgreSQL 数据目录和所有客户的存储）。systemd 单元上的 `ProtectSystem=strict`、`NoNewPrivileges`、`SystemCallFilter` 等只约束进程本身，拦不住与守护进程的 API 对话。
- 不需要快捷服务/Docker 功能的部署，请用 `SKIP_DOCKER=1` 安装，并把应用用户移出 `docker` 组（`gpasswd -d <APP_USER> docker`）；需要的部署请把这台主机视为"应用进程可取得 root"的单租户主机，不要与其他敏感服务共用。
- 更严格的做法（尚未内置）：在应用与 dockerd 之间放一个只放行白名单端点、校验 `HostConfig`（拒绝 `Privileged`、`PidMode=host`、`CapAdd`、`/opt/<服务>` 以外的 `Binds`）的套接字代理，或改用 rootless Docker。
- 安装器会渲染并启用 `<APP_SLUG>-backup.timer`（每日 03:30 全量恢复备份，写入 `BACKUP_DIR`），保留天数与异地上传开关来自环境文件。
