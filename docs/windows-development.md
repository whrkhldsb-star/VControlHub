# Windows 开发与运行指南

VControlHub 的生产部署目标历来是 Debian/Ubuntu（systemd + Caddy + apt 安装链），但代码层面从 2026-09 起已支持在 Windows 上开发、构建和运行。本文说明在 Windows 上的环境搭建、可用的功能范围，以及与 Linux 部署的差异。

## 环境要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 22 LTS | `build:runtime` 以 `--target=node22` 打包；`tsx --env-file-if-exists` 需要 Node ≥ 22.9 |
| PostgreSQL | 15+ | Windows 安装包、便携版（zip）或远程实例均可 |
| Git | 任意近期版本 | 可选，仅克隆代码需要 |
| aria2 | 可选 | 仅影响“中转下载（aria2 磁力/直链）”功能，见下文 |
| Docker Desktop | 可选 | 仅影响 hub-host Docker 管理功能，见下文 |

## 快速开始（开发模式）

```powershell
git clone https://github.com/whrkhldsb-star/VControlHub.git
cd VControlHub
npm ci
copy .env.example .env
# 编辑 .env：填写 DATABASE_URL、AUTH_SESSION_SECRET、ENCRYPTION_KEY、ADMIN_INITIAL_PASSWORD
npm run prisma:generate
npm run prisma:deploy
npm run db:seed
npm run dev
```

说明：

- 从 2026-09 起，所有 `tsx` 驱动的 npm 脚本（`db:seed`、`route:catalog`、`rbac:audit` 等）会自动加载项目根目录的 `.env`（`--env-file-if-exists=.env`）。此前需要手动导出环境变量，这是跨平台修复，Linux 同样受益。
- `prisma generate` 通过 `prisma.config.ts` 读取 `.env`，因此 `.env` 必须先于它创建（`DATABASE_URL` 占位值即可，generate 不连接数据库）。
- Windows 上生成密钥示例（无 openssl 时）：

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # AUTH_SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # ENCRYPTION_KEY / SSH_WS_SECRET
```

## 生产构建与运行（Windows）

Linux 生产环境的入口是 `deploy.sh` / systemd。Windows 使用 PowerShell 安装入口；先安装 Node.js 22.9+ 和 PostgreSQL 15+，准备 `.env.local`，再在管理员 PowerShell 中执行：

```powershell
./deploy/windows/install.ps1
```

首次运行会生成 `.env.local` 并停止，以便填写数据库 URL 和密钥；生成的本地数据目录使用项目内的 `storage/`、`downloads/`、`backups/`。再次运行会自动生成云盘直连签名密钥，随后执行 npm 依赖安装、Prisma 生成及迁移、数据库种子、Next.js 与运行时构建，并注册 Web、Worker、SSH WebSocket 三个开机任务。`-SkipTasks` 只执行构建和数据库步骤，`-SkipSeed` 跳过种子。日志在 `logs/windows-*.log`。公开访问需要另配 Caddy 或 IIS HTTPS 反向代理；将 `/ssh` 转发到 `127.0.0.1:3001`，其余请求转发到 `127.0.0.1:3000`。

手动运行时，三个进程必须读取同一份 `.env.local`，Worker 尤其不会自行加载 Next.js 的环境文件：

```powershell
$env:NODE_ENV="production"
npm run build            # Next.js 生产构建（含 route catalog 预生成）
npm run build:runtime    # esbuild 打包 dist/server.js / dist/worker.js / dist/ssh-ws-proxy.js
node --env-file=.env.local dist/server.js         # Web / API / WebSocket
node --env-file=.env.local dist/worker.js         # 后台 Worker（另开一个终端）
node --env-file=.env.local dist/ssh-ws-proxy.js   # SSH WebSocket 代理（另开一个终端）
```

公开暴露请置于反向代理之后并配置 HTTPS。Windows 原生部署需要手动提供 guacd（例如 WSL2 中运行）才能启用浏览器 RDP；这与管理远端 Windows 节点的 SFTP/Agent 无关。

### Windows 被管服务器的云盘流量

Windows Server 2019/2022/2025 或受支持的 Windows 10/11 可启用 Microsoft OpenSSH Server。添加 Windows VPS 时，RDP 和 SFTP 使用独立凭据；SFTP 根目录以 `/C:/VControlHub/Files` 这类 OpenSSH 路径填写，目录必须事先存在。首次连接需要核对 SSH 主机指纹。Windows SFTP 用户若要让管理端自动安装直连文件网关，还必须拥有管理员权限。

云盘目录浏览始终由管理端访问 SFTP；“网站中转”预览/下载的文件字节经过管理端；“目标直连”由管理端签发短时链接，浏览器向 Windows 文件网关获取字节。默认 `AUTO` 模式会在签发前检查网关健康，不保证文件请求失败后自动重试。Windows 托管网关目前监听 HTTP 31888；公网使用建议在 Windows 上用 Caddy 等反向代理提供 HTTPS，并在存储节点设置 HTTPS 公网地址。关闭网关会恢复中转。

## 平台差异与功能边界

### 已做跨平台处理的路径与端点

| 位置 | Linux 默认 | Windows 默认 |
| --- | --- | --- |
| aria2 中转下载暂存目录 | `/tmp/app-relay-<taskId>` | `%TEMP%\app-relay-<taskId>` |
| 文件版本快照目录 | `/var/lib/vcontrolhub/file-versions` | `%PROGRAMDATA%\VControlHub\file-versions` |
| hub-host Docker 端点 | `/var/run/docker.sock` | `\\.\pipe\docker_engine`（Docker Desktop 命名管） |

均可用环境变量覆盖（既有 `FILE_VERSION_DIR`、`DOCKER_HOST` 等），且 `DOCKER_HOST` 支持 `unix://`、`npipe://`、`tcp://` 三种形式，优先级最高。

### 功能在 Windows 上的边界

| 功能 | Windows 状态 | 说明 |
| --- | --- | --- |
| 纳管 Linux VPS（SSH 命令、SFTP、文件代理、同步、备份、OS 方言探测） | ✅ 完整可用 | 这些操作通过 SSH 在远端 VPS 上执行，远端仍是 Linux 语义，不受本机平台影响 |
| 本地存储节点（LOCAL） | ✅ 可用 | 路径使用本机文件系统 |
| 本机监控（CPU/内存/进程/TCP 连接/网卡流量） | ✅ 可用 | CPU 用 `os.cpus()` 差分；进程列表与 TCP 连接走 PowerShell / `netstat`；网卡计数走 `Get-NetAdapterStatistics`（带 2 秒缓存） |
| 流量页面（本机 + 远端 VPS） | ✅ 可用 | 本机走上述采样器，远端仍通过 SSH 读取 `/proc/net/dev` |
| 压缩包在线列表（tar/tgz/zip） | ✅ 可用 | bsdtar 原生读取 zip（无需 unzip）；`-tv` 输出同时兼容 GNU tar 与 bsdtar 两种列格式 |
| `.gz` 单文件解压 | ✅ 可用 | 使用 Node 内置 zlib，不依赖 gunzip 二进制 |
| 磁力/直链中转下载（aria2） | ⚠️ 需安装 aria2 | 需自行安装 [aria2](https://github.com/aria2/aria2/releases) 并保证 `aria2c.exe` 在 `PATH`；未安装时接口返回缺二进制的友好错误 |
| hub-host Docker 管理 | ⚠️ 需 Docker Desktop | 走命名管或 `DOCKER_HOST`；quick-service 应用模板按 Linux 容器编写（挂载 `/var/run/docker.sock` 等），在 Windows 上仅对远端 VPS 目标有意义 |
| 目录打包下载（tar.gz） | ✅ 可用 | Windows 使用系统自带 bsdtar；`--exclude` 按 glob 匹配（Linux 为字面量匹配），名称含 `*?[` 的排除项可能不精确；排除清单过大（>30K 命令行字符）会明确报错 |
| RDP 远程桌面网关 | ❌ 默认关闭 | 依赖 guacd（guacamole-server，无 Windows 原生版本）。`RDP_ENABLED` 默认非 `true`，不开即无影响；guacd 连接固定 `127.0.0.1`、端口可用 `GUACD_PORT` 覆盖，确需使用可在 WSL2 内运行 guacd 并把端口转发到本机回环 |
| 纳管 Windows RDP 服务器（作为被管对象） | ⚠️ 需 guacd | 连接远端 Windows 服务器的 3389 端口；管理端 Windows 主机需另行运行 guacd（例如 WSL2），Linux 管理端按现有部署配置 |
| 纳管 Windows 云盘 | ✅ 需 OpenSSH Server | SFTP 浏览、中转预览与下载；托管直连网关需管理员权限，公网建议配 HTTPS 反代 |
| `deploy/windows/install.ps1` | ⚠️ 需实机验收 | 已通过 PowerShell 语法检查；生产构建、迁移与开机任务仍需在目标 Windows 版本上端到端验证，PostgreSQL 和 HTTPS 反代需预先准备 |
| `deploy.sh`、Linux `install.sh`、`bootstrap.sh`、Makefile、`scripts/*.sh` | ❌ 不适用 | Linux 部署/CI 专用脚本（依赖 bash/apt/systemd） |
| `ci:local`、`dast:baseline`、`load:baseline`、`release:package` | ❌ 不适用 | 同上，bash 脚本入口 |

### 已知限制

- Linux bash 脚本入口（见上表）在 Windows 上不可用；`verify:deploy-assets` 已改为跨平台包装（Windows 上明确跳过并提示由 Linux CI 覆盖），因此 `npm run verify` 在 Windows 上可完整执行。
- RDP 网关依赖的 guacd 没有 Windows 原生构建。
- Windows 的 `tar.exe`（bsdtar）与 GNU tar 的排除语义有细微差别（见上表）。

## 备份与恢复（Windows 与 Linux 统一入口）

`bash deploy/backup.sh` 是 Linux 的传统入口；Windows 上的应用内备份走 Node 运行器（`scripts/backup.mjs` / `scripts/restore.mjs`）。两个运行器本身是跨平台的（PATH 搜索 pg_dump/psql/tar，Windows 额外探测 Program Files 的 PostgreSQL 目录），因此命令行入口已经统一：

```powershell
npm run backup -- --full                       # 完整备份（数据库 + 文件）
npm run backup -- --files backups/files.tar.gz # 仅文件
npm run backup                                 # 仅数据库，输出到 backups/
npm run restore -- database backups/database.sql.gz
npm run restore -- full backups/full.tar.gz all .
```

- 退出码、日志前缀（`[backup]` / `[restore]`）与 bash 版保持一致，产物（gzip SQL / tar.gz 归档）格式互通。
- 恢复操作是破坏性的：需要环境变量 `CONFIRM_RESTORE=1`（应用内恢复会自动带上）。
- Linux 部署可以继续使用 bash 脚本，也可以用同一组 npm 命令——两者产物格式一致。

## 测试

```powershell
npm run typecheck
npm run lint
npm test
```

单测（vitest）与类型检查在 Windows 上可完整运行。Playwright e2e 未在 Windows 上验证，浏览器矩阵按 CI（Linux）为准。
