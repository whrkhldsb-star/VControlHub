# Daily Site Inspection Plan (7-Day Rotation)
# 每天执行一个专项检查，7天一个完整周期

## Day 1 - 核心基础与认证系统
- 服务器资源: CPU/内存/swap/磁盘/IO
- 服务状态: whrkhldsb-next, whrkhldsb-ssh-ws, apache2, postgresql, docker
- 认证系统: 登录/登出/2FA/会话/CSRF/账户锁定
- 用户管理API: /api/users, /api/users/permissions
- 审计日志API: /api/audit
- Rate limiting: 登录限流/写入限流

## Day 2 - API端点全面扫描
- 遍历所有API路由，逐个测试HTTP状态码
- 验证未认证请求被正确拒绝(307/401/403)
- 检查API响应格式一致性
- 检查API文档 (/api/docs/openapi) 与实际一致

## Day 3 - 前端页面与静态资源
- 所有页面HTTP状态码 (35+页面)
- JS/CSS静态资源加载
- 安全头 (CSP/X-Frame/X-Content-Type/Referrer-Policy)
- WebSocket连接 (/ws 通知 + /ssh 终端)
- Apache反向代理配置完整性

## Day 4 - 业务模块: 服务器管理/SSH/文件/监控
- /api/servers/monitor, /api/servers/[id]/file-proxy
- SSH密钥管理 (/api/ssh-keys 如有)
- 文件操作API: /api/files/list, extract, archive-list
- 监控统计: /api/monitoring/stats
- Docker容器: /api/docker/containers
- 命令审批: /api/commands, /api/command-templates

## Day 5 - 业务模块: 存储/下载/图床/媒体/分享
- 存储API: /api/storage/sftp, sftp-ops, sftp-sync, sftp-download, local, direct-access
- 下载管理: /api/downloads
- 图床: /api/images/* (upload/list/stats/batch/publish)
- 媒体浏览: /api/media
- 分享链接: /api/share-links, /api/share/[token]

## Day 6 - 业务模块: AI/快捷服务/应用商店/告警/定时任务
- AI模块: /api/ai/providers, models, conversations, hosted-actions, chat
- 快捷服务: /api/quick-services, /api/quick-services/check-port, /api/quick-services/[slug]
- 应用源: /api/app-sources (CRUD+同步)
- 告警规则: /api/alert-rules
- 定时任务: /api/scheduled-tasks
- 运维工单: /api/operation-tasks
- 公告: /api/announcements
- 代码片段: /api/snippets

## Day 7 - 部署脚本/数据库/安全/依赖
- 安装脚本: install.sh语法+preflight+check+smoke-test
- 数据库: 迁移状态(prisma migrate status)、连接数、表大小、慢查询
- 安全: npm audit、端口暴露(ss -tlnp)、进程权限
- 依赖更新检查: outdated packages
- systemd服务配置 vs 模板一致性
- 环境变量完整性 (.env.local vs env.production.example)
- 备份脚本: deploy/backup.sh 运行状态
