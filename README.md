# VControlHub

面向个人和小团队的自托管 VPS 管理平台。通过一个 Web 界面管理服务器、SSH 终端、文件存储、应用部署、监控和运维任务。

VControlHub 使用 Next.js、React、TypeScript、PostgreSQL 和 Prisma，生产环境由独立的 Web、后台 Worker 与 SSH WebSocket 进程组成。

## 主要功能

| 模块 | 能力 |
| --- | --- |
| 服务器 | 多 VPS 纳管、浏览器 SSH 终端、SFTP 文件操作、批量命令和审批 |
| Windows 节点 | 浏览器 RDP 远程桌面、Agent 接入（监控指标与命令执行，见 [Windows Agent 设计](docs/windows-agent.md)） |
| 云盘 | LOCAL / SFTP / WebDAV 存储节点、文件浏览与传输、分享链接和在线预览 |
| 应用管理 | Quick Services 应用模板、Docker 与 Compose 项目管理 |
| 监控 | 资源采样、历史趋势、告警规则和通知 |
| 运维 | 定时任务、Playbook、备份、部署记录、工单与审计 |
| AI 助手 | 模型配置、知识库检索和受权限控制的运维工具 |
| 访问控制 | 用户与角色、团队隔离、API Token、可选 TOTP 双因子认证 |
| 界面 | 中文与英文、深色与浅色主题、响应式布局 |

不同存储驱动的能力并不完全相同，部署前请阅读下方的能力边界。

## 安装

### 环境要求

- Debian / Ubuntu 系 Linux；自动安装脚本依赖 `apt`、root 权限与 systemd。Windows 开发与运行见 [Windows 指南](docs/windows-development.md)。
- PostgreSQL；具体依赖安装和运行配置见 [部署文档](deploy/README.md)。
- 推荐使用域名和 HTTPS，公开 Web 入口使用 80/443。
- Web 与 SSH WebSocket 服务默认仅监听本机回环端口 3000/3001，不应直接暴露公网。

### 推荐方式

先下载并检查安装脚本，再执行。安装器会修改系统服务、数据库和反向代理配置，建议使用专用主机并提前备份。

```bash
curl -fsSL https://raw.githubusercontent.com/whrkhldsb-star/VControlHub/main/deploy/bootstrap.sh -o bootstrap.sh
# 检查 bootstrap.sh 后执行
sudo DOMAIN=cloud.example.com bash bootstrap.sh
```

该入口提供安装、更新、健康检查等生命周期操作，默认目录为 `/opt/VControlHub`。无域名安装、离线包、自定义目录和卸载说明见 [deploy/README.md](deploy/README.md)。无域名模式不等于安全的公网部署，生产使用应配置 HTTPS。

### 更新现有部署

推荐使用安装器的更新流程；需要从现有检出目录手动部署时：

```bash
cd /opt/VControlHub
# 先备份数据库、配置、密钥及运行数据，并确认工作区没有未保存修改
# 获取并审查需要部署的版本后：
sudo bash deploy.sh
```

`deploy.sh` 执行生产构建、数据库迁移、服务更新与 smoke checks。不要在正在提供服务的 `.next` 目录上直接运行普通构建替代部署流程。

## 本地开发

使用与项目工具链兼容的 Node.js 和可访问的 PostgreSQL。环境变量示例见 [`.env.example`](.env.example)，生产示例见 [`deploy/env.production.example`](deploy/env.production.example)。不要复用生产凭据或生产数据库进行开发测试。

```bash
git clone https://github.com/whrkhldsb-star/VControlHub.git
cd VControlHub
npm ci
cp .env.example .env
# 编辑 .env，填写开发数据库连接与必要密钥
npm run prisma:generate
npm run prisma:deploy
npm run db:seed
npm run dev
```

上述开发服务器用于页面和普通 API 开发。完整 WebDAV 非标准 HTTP 方法需要自定义 Node 服务器；普通 `next dev` / `next start` 不能替代完整生产入口。SSH 终端和后台任务也需要对应独立进程与配置。

Windows 上的开发、构建与运行同样受支持（平台差异与功能边界见 [Windows 指南](docs/windows-development.md)）；所有 `tsx` 驱动的脚本会自动加载项目根目录的 `.env`。

## 架构与目录

```text
浏览器 / API 客户端
        │
  HTTPS 反向代理
        ├── Web / API（自定义 Node + Next.js）
        └── SSH WebSocket 代理
                    │
       PostgreSQL + 后台 Worker
                    │
       VPS / 存储节点 / 外部服务
```

```text
src/app/          页面、API 路由和页面相关逻辑
src/components/   共享 UI 组件
src/lib/          认证、存储、任务及其他业务模块
src/server.ts     自定义 Web 服务入口
src/worker.ts     后台任务入口
src/ssh-ws-proxy.ts SSH WebSocket 入口
prisma/           数据模型、迁移和初始化数据
scripts/          检查与开发工具
deploy/           安装、服务配置和发布工具
docs/             功能设计、兼容性与维护文档
```

## 文件分享与 WebDAV

分享链接的访问者无需登录平台账号；密码、有效期、访问限制与链接撤销仍由服务端校验。在线打开的能力取决于文件类型、浏览器支持和安全策略，不支持的格式应下载后查看。

项目中的 WebDAV 分为两种用途：

- **连接外部 WebDAV 存储**：通过服务端代理读取或写入远端节点，凭据不发送给浏览器。
- **对外提供 WebDAV 接口**：通过 `/api/webdav/{nodeId}` 和 API Token 挂载受支持的节点，仍执行权限校验。

### 能力边界

- 不声明支持完整 DAV 2、锁或所有第三方客户端行为。
- WebDAV 分享不提供整目录打包下载。
- 远端支持 Range 时使用分段读取；忽略 Range 的服务采用流式截取回退，仍可能需要读取前置字节。
- 远端缺失但具有版本历史或子项的索引保留并告警，避免破坏历史；此类记录可能继续显示。
- 已有本地 HTTP fixture 和安全回归测试，不代表已完成 Nextcloud、群晖、坚果云等真实服务的全量兼容认证。
- 反向代理、CDN 或防火墙必须允许 WebDAV HTTP 方法，不能对客户端施加浏览器交互挑战。

详见 [WebDAV 兼容性说明](docs/webdav-compatibility.md) 和 [文件预览与分享](docs/file-preview-sharing.md)。

## 检查与测试

```bash
npm run typecheck
npm run lint
npm test
npm run route:verify
npm run rbac:audit
npm run i18n:key-check
npm run api-copy:audit
npm run docs:check
```

部署后可以验证 WebDAV 原始 HTTP 入口：

```bash
python3 scripts/webdav-http-smoke.py http://127.0.0.1:3000
```

该检查不使用凭据、不执行存储写入，只验证方法路由和认证提示；不能替代已认证的端到端读写测试。

## 安全与配置

- 不要提交 `.env`、API Token、SSH 私钥、备份或运行数据。
- 密钥和加密配置应独立备份；丢失密钥可能导致已保存的凭据无法解密。
- 为外部集成创建最小权限 Token，并定期轮换。
- 文件分享链接属于访问凭证，请仅发给预期接收者；不再使用时及时撤销。
- 内部浏览器 API 请求使用统一客户端，CSRF 与特殊请求边界见 [前端请求规范](docs/frontend-fetch-policy.md)。
- 不要在公开 Issue 中贴出凭据或包含敏感信息的日志。

## 参与开发

提交 Issue 时请提供复现步骤、部署方式、预期行为和脱敏日志。提交代码前运行相关测试及类型、lint 检查；涉及路由、权限或翻译时，同时运行对应审计。

版本变更记录见 [CHANGELOG.md](CHANGELOG.md)。发布前可运行 `npm run version:check`；版本包生成见部署文档。

## 许可证

当前仓库未包含独立的 LICENSE 文件。公开可见不等于授予开源许可证；使用、修改或分发前请向维护者确认授权范围。

<details>
<summary>仓库统计（自动生成，不代表运行验收结果）</summary>

<!-- README_METRICS_START -->
| 指标            | 数量                                             |
| --------------- | ------------------------------------------------ |
| 功能页面            | 55                                               |
| API 路由文件        | 185                                              |
| 数据模型            | 78                                               |
| UI 组件           | 91                                               |
| 代码行数            | ~293,684（src 扫描）                                 |
| 测试              | 708 文件                                           |
| Docker 应用模板     | 44 (本地) + 社区源实时同步                                |
| i18n            | 263 useI18n() 调用点，84 字典文件                        |
<!-- README_METRICS_END -->

通过 `npm run readme:metrics:write` 更新。

</details>
