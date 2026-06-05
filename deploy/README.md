# VControlHub 部署与迁移说明

本目录提供把 VControlHub 部署到新机器的脚本和模板。默认应用标识为 `VControlHub` / `vcontrolhub`，安装脚本和打包脚本均支持通过 `APP_NAME`、`APP_SLUG`、`SITE_NAME`、`SERVICE_PREFIX`、`PACKAGE_ROOT_NAME` 和 `DOMAIN` 改成任意新品牌/新域名。目标是：在一台干净的 Debian/Ubuntu systemd 主机上，复制项目后可以通过一个脚本完成依赖安装、构建、数据库迁移、systemd 服务安装和 Caddy 反代配置。

## 快速部署

### 方式 A：fresh server 一行命令安装（推荐）

适合全新 Debian/Ubuntu systemd 主机。默认从公开 GitHub 仓库拉取 `main` 分支到 `/opt/vcontrolhub`，随后调用 `deploy/install.sh` 完成依赖安装、环境变量生成、PostgreSQL 初始化、Prisma 迁移/种子、Next.js/runtime 构建、systemd unit、反向代理和服务启动。该命令会先进入交互式配置：依次询问域名、应用名/slug、安装目录、systemd 服务前缀、Next.js 服务端口、SSH WebSocket 服务端口、仓库地址和分支；一路回车会采用默认值，适合快速 fresh install。

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo DOMAIN=your.example.com bash
```

IP 直连/无域名：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | sudo bash
```

常用覆盖项：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo APP_DIR=/opt/vcontrolhub APP_SLUG=vcontrolhub SERVICE_PREFIX=vcontrolhub DOMAIN=your.example.com bash
```

如需私有仓库或 fork：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo REPO_URL=https://github.com/your-org/your-repo.git BRANCH=main APP_DIR=/opt/my-console DOMAIN=your.example.com bash
```

非交互/自动化环境可显式跳过提示并只使用默认值或环境变量覆盖：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo VCONTROLHUB_ASSUME_DEFAULTS=1 DOMAIN=your.example.com bash
```

安装成功后查看首次登录密码：

```bash
sudo /opt/vcontrolhub/deploy/install.sh --show-credentials
```

> 该入口不会要求先手动 clone，也不会把 token/密码写入文档或 Git remote。私有仓库请优先使用机器上已有 SSH deploy key 或临时 HTTPS 凭据。

### 方式 B：已有 Git 仓库目录部署

适合已经把代码放在服务器上的情况。仓库里不要提交 `.env.local`、私钥、数据库备份、上传/下载文件或日志。

```bash
sudo APP_NAME="my-console" APP_SLUG=my-console SITE_NAME="我的控制台" APP_DIR=/opt/my-console DOMAIN=your.example.com /opt/my-console/deploy/install.sh
```

### 方式 C：压缩包部署，解压后直接运行一键脚本

适合离线交付、面板上传、对象存储下载、U 盘拷贝等场景。先在当前服务器生成不含敏感数据和运行数据的发布包：

```bash
cd /opt/VControlHub
./deploy/package.sh
# 默认输出示例：/opt/VControlHub/dist/vcontrolhub-release-YYYYMMDD-HHMMSS.tar.gz
# 自定义包名/根目录：APP_NAME="我的 控制台" APP_SLUG=my-console PACKAGE_ROOT_NAME=my-console-bundle ./deploy/package.sh
```

把压缩包传到新服务器后：

```bash
tar -xzf my-console-release-YYYYMMDD-HHMMSS.tar.gz
cd my-console-bundle   # 默认包则是 vcontrolhub-release
sudo APP_NAME="我的控制台" APP_SLUG=my-console SITE_NAME="我的控制台" \
  SERVICE_PREFIX=my-console DOMAIN=your.example.com APP_DIR=/opt/my-console ./install.sh
# 首次运行会生成 /opt/my-console/.env.local 并停止；编辑后重新运行。
sudoedit /opt/my-console/.env.local
sudo APP_NAME="我的控制台" APP_SLUG=my-console SITE_NAME="我的控制台" SERVICE_PREFIX=my-console DOMAIN=your.example.com APP_DIR=/opt/my-console ./install.sh
```

`deploy/package.sh` 默认排除 `.env.local`、`.env.*.local`、私钥、数据库/备份、`node_modules`、`.next`、上传/下载/日志/临时文件和运行态云盘数据。

### 方式 D：不上公网仓库，从旧服务器/本地目录同步部署

适合代码只保留在当前服务器或内网机器。先把源码传到新服务器，再用 `SOURCE_DIR` 同步到最终安装目录。

```bash
# 在旧服务器或本地机器执行；按实际新服务器地址替换 root@new-server。
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude .env.local \
  --exclude storage --exclude tmp --exclude uploads --exclude downloads --exclude backups --exclude logs \
  /opt/VControlHub/ root@new-server:/root/vcontrolhub-src/

# 在新服务器执行。
cd /root/vcontrolhub-src
sudo SOURCE_DIR=/root/vcontrolhub-src APP_DIR=/opt/vcontrolhub DOMAIN=your.example.com deploy/install.sh
sudoedit /opt/vcontrolhub/.env.local
sudo SOURCE_DIR=/root/vcontrolhub-src APP_DIR=/opt/vcontrolhub DOMAIN=your.example.com deploy/install.sh
```

### 方式 E：已有源码目录时

```bash
cd /path/to/VControlHub
sudo DOMAIN=your.example.com APP_DIR=/opt/vcontrolhub deploy/install.sh
# 首次运行会生成 /opt/vcontrolhub/.env.local 并停止；编辑后重新运行同一命令。
sudoedit /opt/vcontrolhub/.env.local
sudo DOMAIN=your.example.com APP_DIR=/opt/vcontrolhub deploy/install.sh
```

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_NAME` | `VControlHub` | 应用/品牌名；可为中文 |
| `APP_SLUG` | 从 `APP_NAME` 自动生成，空时 `vcontrolhub` | 安全短标识，用于默认安装目录、运行目录和 cookie/session issuer |
| `SITE_NAME` | `$APP_NAME` | systemd 描述、部署展示名 |
| `SERVICE_PREFIX` | `$APP_SLUG` | systemd 服务名前缀，生成 `$SERVICE_PREFIX-next.service` 与 `$SERVICE_PREFIX-ssh-ws.service` |
| `APP_DIR` | `/opt/$APP_SLUG` | 应用安装目录 |
| `APP_USER` | `$APP_SLUG` | systemd 运行用户 |
| `DOMAIN` | 空 | Caddy 绑定域名；为空时跳过 Caddy 配置 |
| `ENV_FILE` | `$APP_DIR/.env.local` | 运行环境变量文件 |
| `ENV_TEMPLATE` | `$APP_DIR/deploy/env.production.example` | 首次创建 `.env.local` 使用的模板 |
| `SOURCE_DIR` | 当前仓库根目录 | 无 `REPO_URL` 时从该目录 rsync 到 `APP_DIR` |
| `REPO_URL` | 空 | 指定后从 Git 仓库 clone/pull |
| `SKIP_PACKAGES` | `0` | 设为 `1` 跳过 apt/Node/Caddy 安装 |
| `SKIP_CADDY` | `0` | 设为 `1` 跳过 Caddy 配置 |
| `SKIP_DB_SETUP` | `0` | 设为 `1` 跳过 `prisma migrate deploy` |
| `SKIP_RESTART` | `0` | 只安装/构建不重启服务 |
| `PACKAGE_ROOT_NAME` | `$APP_SLUG-release` | `deploy/package.sh` 生成压缩包内顶层目录 |
| `ARCHIVE_NAME` | `$APP_SLUG-release-$STAMP.tar.gz` | `deploy/package.sh` 输出文件名 |

> `APP_SLUG` 可包含短横线（如 `my-console`），用于目录、service、cookie 等标识；安装脚本为 PostgreSQL 默认库名/用户名会单独转换为安全标识符（如 `my_console`）。如果你显式设置 `PG_DB_NAME` / `PG_DB_USER`，脚本会按你的值使用。

安装脚本会在全新 Debian/Ubuntu 主机上自动安装基础依赖：`ca-certificates`、`curl`、`gnupg`、`git`、`openssh-client`、`sshpass`、`rsync`、`postgresql-client`、`build-essential`，并在缺少 Node 或 Node 主版本低于 `NODE_VERSION_MAJOR`（默认 22）时通过 NodeSource 安装 Node.js；未设置 `SKIP_CADDY=1` 且系统缺少 Caddy 时，也会自动安装 Caddy。脚本随后执行 `npm ci`、`npm run prisma:generate`、`npm run prisma:deploy`（除非 `SKIP_DB_SETUP=1`）、`npm run build`、`npm run build:runtime`（编译 `src/server.ts` 到 `dist/server.js`，跳过会导致后台 worker 不更新），最后写入 systemd 并重启服务。

安装脚本会在生成 systemd unit 时自动探测当前可用的 `node`、`npm`、`npx` 绝对路径，并把这些目录写入 systemd `PATH`。这可以兼容 Node 安装在 `/root/.local/bin`、`/usr/local/bin`、NodeSource `/usr/bin` 等不同位置的服务器，避免 systemd 启动时报 `/usr/bin/env: node: No such file or directory`。

首次部署时脚本会优先从 `deploy/env.production.example` 创建 `.env.local`，然后主动停止并提示你编辑配置；这样可以避免带着占位密码/占位密钥继续构建。生产使用前必须设置：

- `DATABASE_URL`
- `AUTH_SESSION_SECRET`
- `ADMIN_INITIAL_PASSWORD`
- `NEXT_PUBLIC_APP_PUBLIC_LABEL`
- `HOSTNAME` / `DOMAIN` 相关地址
- `STORAGE_ROOT`、`DOWNLOAD_ROOT`
- 如启用内置 SSH WebSocket：`SSH_WS_HOST`、`SSH_WS_PORT`、`SSH_WS_ALLOWED_ORIGINS`

> 不要把 `.env.local`、私钥、真实数据库连接串提交到仓库。


## 运维脚本入口

除 `deploy/install.sh` 外，仓库还提供以下可移植入口，便于在新机器或升级环境中复用。生产服务器推荐先执行 `make help` 查看统一维护入口；`Makefile` 会把常用的构建、runtime bundle、重启、健康检查和 smoke 串成固定命令，避免漏掉 systemd 实际运行的 `dist/server.js`/`dist/ssh-ws-proxy.js`。

| 入口 | 用途 | 示例 |
| --- | --- | --- |
| `Makefile` | 本地/生产统一维护入口 | `make verify && sudo make restart && make smoke DOMAIN=your.example.com SERVICE_PREFIX=vcontrolhub` |
| `deploy/preflight.sh` | 部署前置检查；验证基础命令、环境变量占位符、Node 版本、端口占用、磁盘空间和运行目录，且不输出密钥值 | `APP_DIR=/opt/my-console ENV_FILE=/opt/my-console/.env.local deploy/preflight.sh` |
| `deploy/upgrade.sh` | 升级部署；默认先创建升级前数据库备份，再复用 `install.sh` 的构建/迁移/重启流程，最后执行 `deploy/check.sh` | `sudo APP_NAME=my-console APP_SLUG=my-console APP_DIR=/opt/my-console DOMAIN=your.example.com deploy/upgrade.sh` |
| `deploy/check.sh` | 检查环境变量、运行目录、systemd 服务和本地 `/login`，可选运行完整 npm 验证 | `APP_DIR=/opt/vcontrolhub CHECK_PUBLIC_URL=https://your.example.com deploy/check.sh` |
| `deploy/backup.sh` | 备份数据库到 `BACKUP_DIR`，内部调用 `scripts/backup-db.sh` | `sudo APP_DIR=/opt/vcontrolhub BACKUP_DIR=/var/backups/vcontrolhub deploy/backup.sh` |
| `scripts/restore-db.sh` | 从 `.sql` 或 `.sql.gz` 恢复数据库；默认需要 `CONFIRM_RESTORE=1` 防误操作 | `CONFIRM_RESTORE=1 APP_DIR=/opt/vcontrolhub scripts/restore-db.sh /var/backups/vcontrolhub/xxx.sql.gz` |

`deploy/check.sh` 默认只做轻量运行检查；如需在目标机器上执行完整质量门禁，可加：

```bash
RUN_NPM_CHECKS=1 APP_DIR=/opt/vcontrolhub deploy/check.sh
```

## 升级部署

```bash
cd /path/to/VControlHub
sudo APP_NAME=my-console APP_SLUG=my-console APP_DIR=/opt/my-console DOMAIN=your.example.com deploy/upgrade.sh
```

`deploy/upgrade.sh` 默认会：

1. 在 `$BACKUP_DIR`（默认 `$APP_DIR/backups`）创建 `pre-upgrade-*.dump` 数据库备份；
2. 以 `SKIP_PACKAGES=1` 调用 `deploy/install.sh`，重新同步源码、执行 `npm ci`、`prisma generate`、`prisma migrate deploy`、`npm run build` 与 `npm run build:runtime`（缺一会导致后台 worker 仍跑旧代码）并重启服务；
3. 调用 `deploy/check.sh` 做本地 `/login`、systemd、运行目录和危险开关检查。

可选开关：`SKIP_PRE_BACKUP=1` 跳过升级前备份，`SKIP_POST_CHECK=1` 跳过升级后自检，`CHECK_PUBLIC_URL=https://your.example.com` 增加公网 smoke。

## 数据库初始化示例

如果目标机器使用本机 PostgreSQL，可以先创建最小权限数据库用户；也可以跳过本节，直接在 `.env.local` 里填写外部 PostgreSQL 的 `DATABASE_URL`。

```bash
sudo -u postgres psql <<'SQL'
CREATE USER vcontrolhub WITH PASSWORD 'REPLACE_WITH_DB_PASSWORD';
CREATE DATABASE vcontrolhub OWNER vcontrolhub;
SQL
```

随后把 `.env.local` 中的 `DATABASE_URL` 改成对应连接串。不要在聊天记录、README 或提交历史里写入真实密码。

## 安全校验

`deploy/install.sh` 会拒绝继续执行以下不安全配置：

- `DATABASE_URL`、`AUTH_SESSION_SECRET`、`ADMIN_INITIAL_PASSWORD` 仍为空或仍是占位值；
- `AUTH_SESSION_SECRET` 少于 32 个字符；
- `SSH_WS_ALLOWED_ORIGINS` 或公开标签仍是示例域名；
- 生产安装中启用了 `ENABLE_DEMO_FALLBACK=true`、`AUTH_DEMO_FALLBACK=true`、`SERVER_DEMO_FALLBACK=true`、`STORAGE_DEMO_FALLBACK=true`、`COMMAND_DEMO_FALLBACK=true` 或 `SEED_DEMO_DATA=true`。

`deploy/install.sh` 在正式构建前会自动调用 `deploy/preflight.sh`，提前检查基础命令、环境文件、占位符、Node/npm、PostgreSQL 客户端、端口占用、磁盘空间和运行目录。该脚本只输出变量名与检查结果，不打印数据库连接串、密码、token 或私钥值。

如果只是本地演示，请不要使用生产安装脚本直接带 demo fallback 或 demo seed 上线。

## 验证命令

```bash
cd /opt/my-console
set -a; source .env.local; set +a
npm run prisma:generate
npm run typecheck
npm run lint
npm test
npm run build
npm run build:runtime  # 必跑：编译 src/server.ts → dist/server.js，否则 alert-worker / scheduled-task-worker 仍跑旧产物
curl -fsS http://127.0.0.1:3000/login >/dev/null
# /health 或 /api/health 在未登录时可能按当前认证策略重定向到 /login，这不代表服务失败。
systemctl status ${SERVICE_PREFIX:-my-console}-next.service ${SERVICE_PREFIX:-my-console}-ssh-ws.service caddy --no-pager
```


## 运行时目录与可移植性规则

这些目录属于每台机器本地运行数据，不应随源码提交或 rsync 覆盖：

- `storage/`：本地云盘/文件管理数据
- `tmp/`：临时检查、转码、中转下载或导入缓存
- `uploads/`、`downloads/`：运行期上传/下载落地目录
- `backups/`、`logs/`：备份和日志

仓库只保留上述目录的 `.gitkeep` 占位文件；`.gitignore` 会忽略目录内真实文件。部署脚本同步源码时也会排除这些目录，避免把当前服务器的数据带到新服务器，或在升级时误删线上数据。新机器应通过 `.env.local` 中的 `STORAGE_ROOT`、`DOWNLOAD_ROOT`、`BACKUP_DIR` 配置自己的实际数据路径。

## 数据库备份

`scripts/backup-db.sh` 已支持可移植变量：

```bash
APP_DIR=/opt/vcontrolhub BACKUP_DIR=/var/backups/vcontrolhub /opt/vcontrolhub/scripts/backup-db.sh
```

Cron 示例：

```cron
0 3 * * * APP_DIR=/opt/vcontrolhub BACKUP_DIR=/var/backups/vcontrolhub /opt/vcontrolhub/scripts/backup-db.sh >> /var/log/vcontrolhub-backup.log 2>&1
```

## 服务结构

- `${SERVICE_PREFIX:-vcontrolhub}-next.service`：Next.js 应用，默认监听 `127.0.0.1:3000`
- `${SERVICE_PREFIX:-vcontrolhub}-ssh-ws.service`：SSH WebSocket 辅助服务，默认监听 `127.0.0.1:3001`
- `caddy`：公网 HTTPS 反向代理
- PostgreSQL：通过 `DATABASE_URL` 连接，可以是本机或外部数据库

## 回滚建议

1. 部署前保留数据库备份：`scripts/backup-db.sh`。
2. 保留上一版源码目录或 Git tag。
3. 如新版本异常：回退源码后执行 `npm ci && npm run prisma:generate && npm run build && npm run build:runtime && systemctl restart ${SERVICE_PREFIX:-vcontrolhub}-next.service ${SERVICE_PREFIX:-vcontrolhub}-ssh-ws.service`。


### Optional: AList WebDAV rclone mount

If the target host also runs AList and needs the cloud-drive mount for Emby/media access, install the optional rclone unit after creating a valid `alist:` remote in rclone:

```bash
sudo install -m 0644 deploy/systemd/rclone-alist.service.example /etc/systemd/system/rclone-alist.service
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-alist.service
systemctl is-active rclone-alist.service
mount | grep ' /media/alist '
```

The unit intentionally runs `rclone mount` in the foreground (`Type=simple`, no `--daemon`) so systemd can track the real mount process. If migrating from an old daemonized unit, stop it first and clear any stale mount with `fusermount -uz /media/alist`.
