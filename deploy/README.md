# VControlHub 部署与迁移说明

本目录提供把 VControlHub 部署到新机器的脚本和模板。默认应用标识为 `VControlHub` / `vcontrolhub`，安装脚本和打包脚本均支持通过 `APP_NAME`、`APP_SLUG`、`SITE_NAME`、`SERVICE_PREFIX`、`PACKAGE_ROOT_NAME` 和 `DOMAIN` 改成任意新品牌/新域名。目标是：在一台干净的 Debian/Ubuntu systemd 主机上，复制项目后可以通过一个脚本完成依赖安装、构建、数据库迁移、systemd 服务安装和 Caddy 反代配置。

## 快速部署

### 方式 A：一行生命周期菜单（推荐）

适合 **Debian 12 / Ubuntu 22.04+ systemd** 主机（`apt-get` 包管理）。同一条命令会显示安装/重装、备份后更新、彻底卸载、健康检查、查看凭据和退出菜单；选择安装后再询问域名、应用名/slug、安装目录、服务前缀、端口、仓库和分支，一路回车采用默认值。

> 系统兼容说明：自动安装依赖支持 Debian/Ubuntu + systemd。RHEL、Rocky、AlmaLinux、Fedora、openSUSE、Arch 等其他 systemd Linux 可预装 Node.js 22.22.2+（22.x）、24.15+（24.x）或 26+、PostgreSQL、git、curl、make、gcc、Python 3、OpenSSL 与 Caddy，再以 `SKIP_PACKAGES=1 SKIP_DOCKER=1 DOMAIN=your.example.com` 运行 `deploy/install.sh`。非 apt 的无域名 Apache 自动配置不适用；使用域名和已安装的 Caddy。Windows 生产部署见 [Windows 指南](../docs/windows-development.md) 和 `deploy/windows/install.ps1`。

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
  sudo APP_DIR=/opt/VControlHub APP_SLUG=vcontrolhub SERVICE_PREFIX=vcontrolhub DOMAIN=your.example.com bash
```

如需私有仓库或 fork：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo REPO_URL=https://github.com/your-org/your-repo.git BRANCH=main APP_DIR=/opt/my-console DOMAIN=your.example.com bash
```

非交互/自动化环境必须通过 `VCONTROLHUB_ACTION` 选择操作。完整卸载还要求 `VCONTROLHUB_UNINSTALL_CONFIRM=1`，防止误删：

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo VCONTROLHUB_ASSUME_DEFAULTS=1 VCONTROLHUB_ACTION=install DOMAIN=your.example.com bash

curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh | \
  sudo VCONTROLHUB_ASSUME_DEFAULTS=1 VCONTROLHUB_ACTION=uninstall VCONTROLHUB_UNINSTALL_CONFIRM=1 bash
```

安装成功后查看首次登录密码：

```bash
sudo /opt/VControlHub/deploy/install.sh --show-credentials
```

### 完整卸载

卸载器没有保留模式，始终不可恢复地删除应用数据库/角色、密钥配置、运行数据、应用用户、unit、安装器管理的反向代理配置，以及本机 VControlHub Quick Service 容器和数据目录。先用 `--dry-run` 核对精确作用域：

```bash
sudo /opt/VControlHub/deploy/uninstall.sh --dry-run
sudo /opt/VControlHub/deploy/uninstall.sh --yes
```

Node.js、PostgreSQL、Caddy、Apache 和 Docker 是共享系统软件包，不会卸载；无关 Docker 容器、网络、卷和镜像不会删除。

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
# 默认输出示例：/opt/VControlHub/dist/vcontrolhub-v0.1.0.tar.gz
# 自定义包名/根目录：APP_NAME="我的 控制台" APP_SLUG=my-console PACKAGE_ROOT_NAME=my-console-bundle ./deploy/package.sh
```

把压缩包传到新服务器后：

```bash
sudo install -d -m 755 /opt/vcontrolhub-source
sudo tar --no-same-owner -xzf my-console-v0.1.0.tar.gz -C /opt/vcontrolhub-source
cd /opt/vcontrolhub-source/my-console-bundle   # 默认包则是 vcontrolhub-v0.1.0
sudo APP_NAME="我的控制台" APP_SLUG=my-console SITE_NAME="我的控制台" \
  SERVICE_PREFIX=my-console DOMAIN=your.example.com APP_DIR=/opt/my-console ./install.sh
# 首次运行会创建 /opt/my-console/.env.local，自动生成密钥并继续安装完成。
# 如需自定义数据库/端口/外部服务，可编辑后重跑同一命令：
# sudoedit /opt/my-console/.env.local
# sudo APP_NAME="我的控制台" APP_SLUG=my-console SITE_NAME="我的控制台" SERVICE_PREFIX=my-console DOMAIN=your.example.com APP_DIR=/opt/my-console ./install.sh
```

`deploy/package.sh` 只归档当前 Git `HEAD` 中已跟踪且未被 `.gitattributes export-ignore` 排除的文件。本机 `.env`、私钥、数据库/备份、`node_modules`、`.next`、上传/下载/日志/临时文件和未提交改动不会进入版本包。

### 方式 D：不上公网仓库，从旧服务器/本地目录同步部署

适合代码只保留在当前服务器或内网机器。先把源码传到新服务器，再用 `SOURCE_DIR` 同步到最终安装目录。

```bash
# 在旧服务器或本地机器执行；按实际新服务器地址替换 root@new-server。
# 排除项都以 / 开头，只匹配安装目录顶层的运行数据；不带 / 会连同 src/lib/storage、src/lib/downloads 等同名源码目录一起排除。
rsync -a --delete --chown=root:root --chmod=go-w \
  --exclude /.git --exclude /node_modules --exclude /.next --include=/.env.example --exclude='/.env*' \
  --exclude /storage --exclude /tmp --exclude /uploads --exclude /downloads --exclude /backups --exclude /logs \
  /opt/VControlHub/ root@new-server:/root/vcontrolhub-src/

# 在新服务器执行。
cd /root/vcontrolhub-src
sudo SOURCE_DIR=/root/vcontrolhub-src APP_DIR=/opt/VControlHub DOMAIN=your.example.com deploy/install.sh
# 如需自定义，编辑后重跑：
# sudoedit /opt/VControlHub/.env.local
# sudo SOURCE_DIR=/root/vcontrolhub-src APP_DIR=/opt/VControlHub DOMAIN=your.example.com deploy/install.sh
```

### 方式 E：已有源码目录时

```bash
cd /path/to/VControlHub
sudo DOMAIN=your.example.com APP_DIR=/opt/VControlHub deploy/install.sh
# 首次运行会创建 /opt/VControlHub/.env.local、自动生成密钥并继续安装完成。
# 只有需要自定义数据库/端口/外部服务时，才需要编辑后重跑：
# sudoedit /opt/VControlHub/.env.local
# sudo DOMAIN=your.example.com APP_DIR=/opt/VControlHub deploy/install.sh
```

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_NAME` | `VControlHub` | 应用/品牌名；可为中文 |
| `APP_SLUG` | 从 `APP_NAME` 自动生成，空时 `vcontrolhub` | 安全短标识，用于默认安装目录、运行目录和 cookie/session issuer |
| `SITE_NAME` | `$APP_NAME` | systemd 描述、部署展示名 |
| `SERVICE_PREFIX` | `$APP_SLUG` | systemd 服务名前缀，生成 `$SERVICE_PREFIX-next.service`、`$SERVICE_PREFIX-worker.service` 与 `$SERVICE_PREFIX-ssh-ws.service` |
| `APP_DIR` | `/opt/$APP_SLUG` | 应用安装目录 |
| `APP_USER` | `$APP_SLUG` | systemd 运行用户 |
| `DOMAIN` | 空 | Caddy 绑定域名；为空时跳过 Caddy 配置 |
| `ENV_FILE` | `$APP_DIR/.env.local` | 运行环境变量文件 |
| `ENV_TEMPLATE` | `$APP_DIR/deploy/env.production.example` | 首次创建 `.env.local` 使用的模板 |
| `SOURCE_DIR` | 当前仓库根目录 | 无 `REPO_URL` 时从该目录 rsync 到 `APP_DIR` |
| `REPO_URL` | 空 | 指定后从 Git 仓库 clone/pull |
| `SKIP_PACKAGES` | `0` | 设为 `1` 使用已安装的系统依赖；构建仍检查 make、gcc、Python 3 |
| `SKIP_CADDY` | `0` | 设为 `1` 跳过 Caddy 配置 |
| `SKIP_DB_SETUP` | `0` | 设为 `1` 跳过 `prisma migrate deploy` |
| `SKIP_RESTART` | `0` | 只安装/构建不重启服务 |
| `APP_VERSION` | `package.json` 中的版本 | `deploy/package.sh` 生成包的语义版本，可显式覆盖 |
| `PACKAGE_ROOT_NAME` | `$APP_SLUG-v$APP_VERSION` | `deploy/package.sh` 生成压缩包内顶层目录 |
| `ARCHIVE_NAME` | `$APP_SLUG-v$APP_VERSION.tar.gz` | `deploy/package.sh` 输出文件名 |

> `APP_SLUG` 可包含短横线（如 `my-console`），用于目录、service、cookie 等标识；安装脚本为 PostgreSQL 默认库名/用户名会单独转换为安全标识符（如 `my_console`）。如果你显式设置 `PG_DB_NAME` / `PG_DB_USER`，脚本会按你的值使用。

安装脚本会在全新 Debian/Ubuntu 主机上自动安装基础依赖：`ca-certificates`、`curl`、`gnupg`、`git`、`openssh-client`、`sshpass`、`rsync`、`iproute2`、`aria2`、`build-essential`、Python 3、OpenSSL 和 `sudo`，并在 Node.js 与锁定工具链不兼容 时通过 NodeSource 安装 Node.js；设置 `DOMAIN` 且未设置 `SKIP_CADDY=1` 时，系统缺少 Caddy 才会自动安装。脚本随后执行 `npm ci`、`npm run prisma:generate`、`npm run prisma:deploy`（除非 `SKIP_DB_SETUP=1`）、`npm run build`、`npm run build:runtime`（生成 `dist/server.js`、`dist/worker.js` 与 `dist/ssh-ws-proxy.js`），最后写入 systemd 并重启服务。已配置外部 `DATABASE_URL` 时，安装器保留该 URL 并跳过本地 PostgreSQL 账户创建，数据库迁移仍会运行。

安装脚本会在生成 systemd unit 时自动探测当前可用的 `node`、`npm`、`npx` 绝对路径，并把这些目录写入 systemd `PATH`。这可以兼容 Node 安装在 `/root/.local/bin`、`/usr/local/bin`、NodeSource `/usr/bin` 等不同位置的服务器，避免 systemd 启动时报 `/usr/bin/env: node: No such file or directory`。

首次部署时脚本会优先从 `deploy/env.production.example` 创建 `.env.local`，自动生成数据库密码、Session/SSH/云盘直连签名/加密密钥和管理员初始密码，并**继续完成**构建与启动（不会在创建 env 后中途退出）。生产使用前如需自定义外部数据库/端口，再编辑 `.env.local` 后重跑安装脚本。安装器会确保：

- `DATABASE_URL`
- `AUTH_SESSION_SECRET`
- `ADMIN_INITIAL_PASSWORD`
- `NEXT_PUBLIC_APP_PUBLIC_LABEL`
- `HOSTNAME` / `DOMAIN` 相关地址
- `STORAGE_ROOT`
- 如启用内置 SSH WebSocket：`SSH_WS_HOST`、`SSH_WS_PORT`、`SSH_WS_ALLOWED_ORIGINS`

> 不要把 `.env.local`、私钥、真实数据库连接串提交到仓库。


## 运维脚本入口

除 `deploy/install.sh` 外，仓库还提供以下可移植入口，便于在新机器或升级环境中复用。生产服务器推荐先执行 `make help` 查看统一维护入口；`Makefile` 会把常用的构建、runtime bundle、重启、健康检查和 smoke 串成固定命令，避免漏掉 systemd 实际运行的 `dist/server.js`、`dist/worker.js` 与 `dist/ssh-ws-proxy.js`。

| 入口 | 用途 | 示例 |
| --- | --- | --- |
| `Makefile` | 本地/生产统一维护入口 | `make verify && sudo make restart && make smoke DOMAIN=your.example.com SERVICE_PREFIX=vcontrolhub` |
| `deploy/fakeroot-install-check.sh` | installer fakeroot/dry-run 回归；通过 Vitest 的 DESTDIR 隔离 fixture 覆盖域名/Caddy、无域名/Apache、`SKIP_PACKAGES=1`、`DESTDIR` 和凭据同步等 fresh-install 分支，不会改动宿主 systemd/反代服务 | `make installer-fakeroot` |
| `deploy/uninstall.sh` | 彻底删除应用和全部本机应用数据，不提供保留模式；共享软件包和无关 Docker 资源不删除 | `sudo deploy/uninstall.sh --dry-run` |
| `deploy/preflight.sh` | 部署前置检查；验证基础命令、环境变量占位符、密钥值编码（CRLF 行尾/首尾空白）、Node 版本、端口占用、磁盘空间和运行目录，且不输出密钥值 | `APP_DIR=/opt/my-console ENV_FILE=/opt/my-console/.env.local deploy/preflight.sh` |
| `deploy/upgrade.sh` | 升级部署；在独立目录准备并核验候选版本，通过迁移预检后备份、切换目录并验证服务 | `sudo APP_NAME=my-console APP_SLUG=my-console APP_DIR=/opt/my-console DOMAIN=your.example.com deploy/upgrade.sh` |
| `deploy/check.sh` | 检查环境变量、运行目录、systemd 服务和本地 `/login`，可选运行完整 npm 验证 | `APP_DIR=/opt/VControlHub CHECK_PUBLIC_URL=https://your.example.com deploy/check.sh` |
| `deploy/backup.sh` | 备份数据库到 `BACKUP_DIR`，内部调用 `scripts/backup-db.sh` | `sudo APP_DIR=/opt/VControlHub BACKUP_DIR=/var/backups/vcontrolhub deploy/backup.sh` |
| `scripts/restore-db.sh` | 从 `.sql` 或 `.sql.gz` 恢复数据库；默认需要 `CONFIRM_RESTORE=1` 防误操作 | `CONFIRM_RESTORE=1 APP_DIR=/opt/VControlHub scripts/restore-db.sh /var/backups/vcontrolhub/xxx.sql.gz` |

备份/恢复的跨平台等价入口是 `npm run backup` / `npm run restore`（Node 运行器 `scripts/backup.mjs` / `scripts/restore.mjs`，产物格式与 bash 脚本互通）。Windows 主机没有 bash，只能使用 npm 入口；见 `docs/windows-development.md`。

`deploy/check.sh` 默认只做轻量运行检查；如需在目标机器上执行完整质量门禁，可加：

```bash
RUN_NPM_CHECKS=1 APP_DIR=/opt/VControlHub deploy/check.sh
```

## 升级部署

```bash
cd /path/to/VControlHub
sudo APP_NAME=my-console APP_SLUG=my-console APP_DIR=/opt/my-console DOMAIN=your.example.com deploy/upgrade.sh
```

升级脚本在安装目录的同一文件系统准备完整发布。Git 安装按指定分支快进，压缩包安装可用 `SOURCE_DIR` 指向解包目录。安装依赖、生成 Prisma Client、构建页面和后台进程、核验产物期间，旧服务继续运行。

脚本读取目标数据库的 Prisma 迁移记录，只自动执行可识别的增量 DDL。待执行迁移包含删表、删列、清空或改写数据、动态 SQL，或迁移记录无法核实时，升级在停服前退出。请检查报出的迁移并确认可接受数据影响、备份和旧代码兼容性，人工应用后重新运行升级。

### 迁移预检中的大表索引锁定警告（D-01）

增量迁移中的普通 `CREATE INDEX`（不带 `CONCURRENTLY`）仍会自动放行，但当目标是大表（`audit_logs`、`metric_snapshots`、`traffic_snapshots`、`job_events`、`ai_messages`、`notifications`、`share_access_logs`）时，预检会对每条语句输出一行结构化警告：

```
[upgrade-preflight] index-lock-warning {"migration":"…","table":"job_events","statement":"CREATE INDEX …","reason":"…"}
```

原因：普通 `CREATE INDEX` 在建索引全程阻塞该表的写入；这类只追加的大表积累数月数据后建索引可能持续数分钟，期间任务队列、通知写入、审计日志都会排队。推荐做法：

1. 升级窗口前先用 `psql` 对同一索引执行 `CREATE INDEX CONCURRENTLY`（迁移里的语句带 `IF NOT EXISTS` 时随后变成空操作）；
2. 或把升级安排在可接受短暂写入停顿的窗口；
3. 警告只是提示数据，不是失败；不要为消音修改已应用的迁移（校验和会拒绝）。

### Docker 入多副本启动的迁移互斥（D-02）

`docker-entrypoint.sh` 用 PostgreSQL 会话级咨询锁（`pg_advisory_lock(45056, 0)`，通过 `pg` 包的 `node -e` 小客户端持有）串行化 `prisma migrate deploy` 与 seed：并发拉起的多个副本中，抢到锁的先执行迁移与 seed，其余副本阻塞等锁后执行（迁移为空操作、seed 幂等跳过）。要点：

- 锁键 45056 刻意选在应用自身命名空间 45057–45099（`src/lib/concurrency/advisory-lock.ts`）之外，不会与应用内锁冲突；
- 会话锁随连接结束自动释放，容器崩溃不会遗留死锁；
- 锁获取、迁移或 seed 任一失败都会让入口脚本立即非零退出，不允许半迁移状态对外服务；
- 多副本部署：只给一个副本（或一次性 migrate Job）保留 `RUN_MIGRATIONS_ON_START=true` / `SEED_ON_START=true`，其余副本设为 `false`；两者都为 `false` 时整个块被跳过，不取锁、不迁移、不 seed。

脚本默认创建 `pre-upgrade-*.sql.gz` 备份，记录 systemd 状态，再停服务、迁移数据库并切换整个发布目录。运行数据和环境文件随目录切换保留原路径。启动、就绪探测或部署检查失败时，脚本恢复旧代码、客户文件以及先前运行的服务，数据库保留已执行的迁移。成功后旧代码保存在 `$APP_DIR/dist.releases/`，可在确认版本后按主机容量清理。升级沿用已安装的 systemd 和反向代理配置。

`SKIP_PRE_BACKUP=1` 跳过数据库备份。`SKIP_POST_CHECK=1` 跳过扩展自检，启动和本机就绪检查仍会执行。`CHECK_PUBLIC_URL=https://your.example.com` 增加公网检查。`SKIP_BUILD=1` 需要提供独立、完整的预构建版本。旧版安装首次升级可使用最新的一键菜单，菜单会从目标提交读取升级驱动。

### 预检拒绝的密钥编码问题（A-06）

`deploy/preflight.sh` 还会检查 `.env*` 中 `SSH_WS_SECRET`、`AUTH_SESSION_SECRET`、`ENCRYPTION_KEY` 的值编码：值内嵌回车符（通常是 Windows 编辑器保存的 CRLF 行尾被引号包裹残留）或首尾空白（复制粘贴带入的空格/制表符）都会导致实际派生的密钥与预期不一致（`\r` 成为 HMAC 密钥的一部分、尾部空格破坏比较）。预检按变量名报错，不打印值。修复方式：用 LF 行尾重存文件，或删去值两端的空白后重跑预检。

### `TRUSTED_PROXY_HOPS` 与 `X-Forwarded-*` 契约（A-07）

- `TRUSTED_PROXY_HOPS=0`（Compose 默认，应用直接暴露）：自定义服务器把每个请求的对端地址写入内部头并删除客户端自带的同名头（`src/lib/http/peer-address.ts`），限流与审计按真实对端地址分桶，伪造头无效。不加反代时保持 0，切勿在加了反代后仍为 0。
- `TRUSTED_PROXY_HOPS=N>0`（例如随发行版 Caddy 反代的默认 1）：`getClientIp` 从 `X-Forwarded-For` 右侧数第 N 个条目取客户端 IP——由最近一台可信代理追加的条目。客户端无法靠在最左侧塞假条目轮换限流桶。
- 在 Compose `app` 前加显式反代时，把 `TRUSTED_PROXY_HOPS` 设为代理层数，并确认代理是追加（而非覆盖）`X-Forwarded-For`。

### Team 软删除与 `SetNull` 隔离语义（D-06）

两个不同机制保护租户数据，不要混淆：

- **软删除（`Team.deletedAt`）**：平台管理员“删除客户”。所有行保留且保持作用域不可达，成员在下次会话校验即失去访问；清空该字段即恢复。运维面（健康探测、状态汇总）通过 `team: { deletedAt: null }` 排除这些行（`liveCustomerRowsWhere`、`activeCustomerTeamWhere`，见 `src/lib/auth/team-scope.ts`）。
- **`onDelete: SetNull`（隔离）**：物理删除 `Team` 行时，从属行数据保留但 `teamId` 置空。这类行被隔离而非共享：非管理员的租户选择器把 `teamId: null` 当作空匹配（`strictCustomerScope` 的 `id IN ()`，或 `serverTeamWhere` 里的显式空判断），其他客户的成员永远看不到——仅平台管理员的“全部客户”视图仍可列出以备审计。运维存活探测仍覆盖这些行（`liveCustomerRowsWhere` 同时匹配 `teamId: null`——它们仍消耗运行时资源），这正是必须隔离而非删除的原因。

运维原则：UI 里删除客户走软删除（可逆、有审计）；物理删除 `Team` 行仅适用于一次性/CI 数据库，留下的隔离行只有管理员能查。

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
npm run build:runtime  # 必跑：编译 Web、Worker 与 SSH-WS 三个运行入口
curl -fsS http://127.0.0.1:3000/login >/dev/null
# /health 或 /api/health 在未登录时可能按当前认证策略重定向到 /login，这不代表服务失败。
systemctl status ${SERVICE_PREFIX:-my-console}-next.service ${SERVICE_PREFIX:-my-console}-worker.service ${SERVICE_PREFIX:-my-console}-ssh-ws.service caddy --no-pager
```

部署后 smoke 支持按部署形态拆分，避免把本机 systemd、PostgreSQL 和公网反代假设混在一起：

```bash
# 完整默认检查：本机 systemd/端口 + 公网 HTTP
make smoke DOMAIN=your.example.com SERVICE_PREFIX=my-console

# 只检查本机 systemd/端口/localhost（适合外部数据库或反代暂未切换时）
make smoke-systemd SERVICE_PREFIX=my-console

# 只做公网黑盒 HTTP 检查（适合 Compose、自定义反代或非本机部署）
make smoke-http DOMAIN=your.example.com SERVICE_PREFIX=my-console
# 也可直接指定完整公网 URL
SMOKE_PUBLIC_URL=https://your.example.com make smoke-http SERVICE_PREFIX=my-console
```


## 运行时目录与可移植性规则

这些目录属于每台机器本地运行数据，不应随源码提交或 rsync 覆盖：

- `storage/`：本地云盘/文件管理数据
- `tmp/`：临时检查、转码、中转下载或导入缓存
- `uploads/`、`downloads/`：运行期上传/下载落地目录
- `backups/`、`logs/`：备份和日志

仓库只保留上述目录的 `.gitkeep` 占位文件；`.gitignore` 会忽略目录内真实文件。部署脚本同步源码时也会排除这些目录，避免把当前服务器的数据带到新服务器，或在升级时误删线上数据。新机器应通过 `.env.local` 中的 `STORAGE_ROOT`、`BACKUP_DIR` 配置自己的实际数据路径。

### 上传暂存目录与缩略图缓存

分片上传的分片、合并出的完整文件，以及 WebDAV 上传的请求体，在写入云盘之前先放在**上传暂存目录**；生成的缩略图放在**缩略图缓存目录**。两者默认位于数据目录下（文件历史目录的上一级）：

| 用途 | 默认位置 | 环境变量 |
| --- | --- | --- |
| 上传暂存 | `/var/lib/<slug>/upload-tmp` | `MEDIA_UPLOAD_TMP_DIR` |
| 缩略图缓存 | `/var/lib/<slug>/thumbnails` | `MEDIA_THUMB_CACHE_DIR` |

- 这两个目录不放在 `/tmp`：各 systemd 服务的 `/tmp` 互相隔离（`PrivateTmp=true`），Worker 的清理任务看不到 Web 服务写下的文件；而且在 `/tmp` 为内存盘（tmpfs）的系统上，暂存的每个字节都计入 Web 服务的内存上限（`MemoryMax`），同时上传几个大文件就会让整个站点卡住。
- 数据目录不可写时（开发环境、没有挂载数据卷的容器）回退到 `/tmp/vcontrolhub-media-uploads` 与系统临时目录下的 `vcontrolhub-thumbnails`。
- 暂存目录需要的空间：每个进行中的上传约为文件大小的 2 倍（分片 + 合并文件），另外保留 512 MB；空间不足时上传在开始前就被拒绝。暂存目录与本地云盘在同一文件系统时，合并出的文件直接移动到位，不再复制一遍。
- 自定义位置时，Web 与 Worker 两个服务必须都能读写该目录（`ProtectSystem=strict` 下需要写进各自单元的 `ReadWritePaths`），并且应位于磁盘而不是内存盘上。
- 无人认领的暂存数据由维护任务清理：过期的上传会话、会话记录已不存在或已结束的暂存目录、超过 24 小时未写入的 WebDAV 上传临时文件。结果待人工确认的上传会保留其数据，直到管理员处理。

## 数据库备份

`scripts/backup-db.sh` 已支持可移植变量：

```bash
APP_DIR=/opt/VControlHub BACKUP_DIR=/var/backups/vcontrolhub /opt/VControlHub/scripts/backup-db.sh
```

Cron 示例：

```cron
0 3 * * * APP_DIR=/opt/VControlHub BACKUP_DIR=/var/backups/vcontrolhub /opt/VControlHub/scripts/backup-db.sh >> /var/log/vcontrolhub-backup.log 2>&1
```

`deploy/install.sh` 已会渲染并启用 `<APP_SLUG>-backup.service/.timer`（每日 03:30 运行 `scripts/backup.mjs --full`，产物写入环境文件里的 `BACKUP_DIR`，随后由 `dist/upload-recovery-backup.js` 按设置做异地上传）；只有不用安装器的部署才需要上面的 cron。查看：`systemctl list-timers '<APP_SLUG>-backup*'`。

## 服务结构

- `${SERVICE_PREFIX:-vcontrolhub}-next.service`：Next.js 应用，默认监听 `127.0.0.1:3000`
- `${SERVICE_PREFIX:-vcontrolhub}-worker.service`：独立后台任务进程，通过数据库心跳向 Web 端报告健康状态
- `${SERVICE_PREFIX:-vcontrolhub}-ssh-ws.service`：SSH WebSocket 辅助服务，默认监听 `127.0.0.1:3001`
- `${SERVICE_PREFIX:-vcontrolhub}-aria2.service`：磁力/BT 中继下载守护进程（`deploy/aria2-daemon.sh` 拉起 `aria2c`，只监听 `127.0.0.1:6800`）。该 unit 用 `IPAddressDeny` 禁止访问私有网段、CGNAT、链路本地与云元数据地址，只放行回环供应用 RPC 调用；安装器与 `deploy.sh` 会写入 `ARIA2_MANAGED_EXTERNALLY=1`，应用因此不再自行拉起无限制的 aria2。没有 systemd 或未安装 `aria2c` 的主机保持旧的自拉起行为。该守护进程的 BitTorrent 监听（peer 与 DHT）固定在 `6881–6889/tcp+udp`，可在防火墙中按需放行或封锁；LAN 对等发现（LPD）已关闭。Docker Compose 拓扑不带 `aria2c`，磁力/BT 中继在该拓扑下不可用（http/https 下载不受影响，由目标 VPS 自行下载）。
- `caddy`：公网 HTTPS 反向代理
- PostgreSQL 14 及以上：通过 `DATABASE_URL` 连接，可以是本机或外部数据库（公开看板的历史图表用到 PostgreSQL 14 的 `date_bin`；Debian 11 自带的 13、Ubuntu 20.04 自带的 12 都不够，需要改装官方源的新版本）

## 回滚建议

1. 部署前保留数据库备份：`scripts/backup-db.sh`。
2. 保留上一版源码目录或 Git tag。
3. 如新版本异常：回退源码后执行 `npm ci && npm run prisma:generate && npm run build && npm run build:runtime && systemctl restart ${SERVICE_PREFIX:-vcontrolhub}-next.service ${SERVICE_PREFIX:-vcontrolhub}-worker.service ${SERVICE_PREFIX:-vcontrolhub}-ssh-ws.service`。


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

### 维护目录和旧版 Windows 任务

Linux 安装和升级请从管理员控制的源码和安装目录运行。服务账户只需写入数据目录。若旧安装的程序或配置仍由服务账户持有，请停服、保存并核对环境文件和数据，用可信发布包恢复程序及维护脚本，并将程序、配置和父目录交由 root 管理。构建在单独的低权限账户下执行。

Windows 的 SYSTEM 任务从受保护的 `.vch-releases/current` 启动。发布器在停服期间切换完整程序和配置，保留原地的数据目录，并在首次发布时将检出目录的旧数据路径联接到运行目录。请使用 SYSTEM 或 Administrators 所有、普通账户只读的安装目录、源码及 Node.js 工具链。首次从直接引用检出目录的旧任务升级时，用 `-PreviousRelease` 指定原版本的完整受保护副本，包括原来的运行脚本、辅助脚本、依赖、静态资源、构建产物和环境配置。该副本的数据路径须指向原安装的持久目录。后续升级失败时，发布器恢复上个版本的全部程序文件和任务定义。每个版本使用发布时复制的环境配置。修改数据库或监听端口后，请用更新的 `.env.local` 重新发布，安装器会在迁移前报告与当前进程冲突的键名。

### 旧版 CSV 账单升级核对

同一天、同一产品同时含有供应商 ID 和无 ID 条目的账单，请在成本页重新同步受影响的月份。导入会核对旧条目的币种、金额、类别和供应商，迁移可确认的旧序号，并保留条目 ID。部分导出或无法匹配的旧条目会使整批回滚，管理员可在运行记录中查看原因。同月同币种包含分以下精度的费用时，请提供完整月账单，以便核对分币分摊。

升级时，数据库管理员可用下面的只读查询列出同日混用显式 ID 与旧序号的账户和月份，再按供应商原账单核对产品及行数。

```sql
WITH mixed_days AS (
  SELECT split_part("sourceRef", ':', 1) AS account_id, "effectiveDate"
  FROM cost_entries
  WHERE "sourceType" = 'cloud_billing' AND split_part("sourceRef", ':', 2) = 'csv'
  GROUP BY 1, 2
  HAVING bool_or(split_part("sourceRef", ':', 3) = 'id')
     AND bool_or(split_part("sourceRef", ':', 3) = 'natural' AND NOT ('csv-ordinal:v2' = ANY(tags)))
)
SELECT DISTINCT account_id, to_char("effectiveDate", 'YYYY-MM') AS month
FROM mixed_days ORDER BY account_id, month;
```

如果旧版重排同步已经留下两条内容相同的费用，请先对照供应商完整月账单，确认重复条目、真实行数与总额。确认后，使用具有 `cost:manage` 权限的会话向 `POST /api/cost/billing-accounts/{id}/sync` 提交 `{"month":"YYYY-MM","confirmLegacyDuplicates":true}`。服务会在同一事务中合并匹配的旧条目并迁移调整引用。金额或币种无法匹配时仍会中止。完成后核对该月各币种总额。

预算告警的投递回执保存在独立表 `cost_budget_alert_deliveries`。Linux 和 Windows 安装器在数据库迁移阶段建表，并从仍在收件箱中的旧告警补录回执。其他部署方式会在首次告警时检查并初始化。数据库区分迁移角色和运行角色时，请在同版本的源码目录用迁移角色执行 `npm exec --no -- tsx deploy/prepare-cost-ledger.ts`，并给运行角色授予该表的 SELECT、INSERT 权限。
