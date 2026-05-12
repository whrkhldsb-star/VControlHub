/**
 * OpenAPI/Swagger spec generator — scans all API routes and produces a spec.
 * GET /api/docs/openapi.json
 */
import { NextResponse } from "next/server";

const spec = {
	openapi: "3.0.3",
	info: {
		title: "VPS 统一管控平台 API",
		description: "VPS管理平台的完整RESTful API文档，包含认证、服务器、文件、Docker、监控等模块。",
		version: "2.0.0",
		contact: { name: "VPS管控平台" },
	},
	servers: [{ url: "/api", description: "当前服务器" }],
	tags: [
		{ name: "认证", description: "登录、登出、2FA" },
		{ name: "服务器", description: "服务器管理和监控" },
		{ name: "文件", description: "文件管理、SFTP" },
		{ name: "下载站", description: "下载任务管理" },
		{ name: "图床", description: "图片上传和管理" },
		{ name: "Docker", description: "容器管理" },
		{ name: "监控", description: "系统监控和健康检查" },
		{ name: "用户", description: "用户和权限管理" },
		{ name: "审计", description: "审计日志" },
		{ name: "通知", description: "通知管理" },
		{ name: "快服务", description: "一键Docker部署" },
		{ name: "代码片段", description: "代码片段管理" },
		{ name: "备份", description: "备份和恢复" },
		{ name: "AI", description: "AI助手" },
		{ name: "系统", description: "系统设置和健康" },
	],
	paths: {
		"/login": {
			post: {
				tags: ["认证"],
				summary: "用户登录",
				requestBody: {
					required: true,
					content: { "application/json": { schema: { type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string" } } } } },
				},
				responses: { "200": { description: "登录成功" }, "401": { description: "用户名或密码错误" } },
			},
		},
		"/auth/signout": {
			post: { tags: ["认证"], summary: "用户登出", responses: { "200": { description: "登出成功" } } },
		},
		"/auth/2fa/setup": {
			post: { tags: ["认证"], summary: "生成2FA密钥和二维码", responses: { "200": { description: "返回secret和otpauthUrl" } } },
			put: { tags: ["认证"], summary: "验证TOTP码", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code", "secret"], properties: { code: { type: "string" }, secret: { type: "string" } } } } } }, responses: { "200": { description: "验证结果" } } },
		},
		"/auth/2fa/enable": {
			post: { tags: ["认证"], summary: "启用2FA", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code", "secret"], properties: { code: { type: "string" }, secret: { type: "string" } } } } } }, responses: { "200": { description: "已启用" } } },
		},
		"/auth/2fa/disable": {
			post: { tags: ["认证"], summary: "禁用2FA", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } } }, responses: { "200": { description: "已禁用" } } },
		},
		"/servers/monitor": {
			get: { tags: ["服务器"], summary: "获取服务器监控数据", parameters: [{ name: "id", in: "query", schema: { type: "string" }, description: "服务器ID" }], responses: { "200": { description: "监控数据" } } },
		},
		"/storage/local": {
			get: { tags: ["文件"], summary: "列出本地文件", parameters: [{ name: "path", in: "query", schema: { type: "string" }, description: "目录路径" }], responses: { "200": { description: "文件列表" } } },
		},
		"/storage/sftp": {
			get: { tags: ["文件"], summary: "SFTP连接管理", responses: { "200": { description: "连接列表" } } },
			post: { tags: ["文件"], summary: "创建SFTP连接", responses: { "200": { description: "已创建" } } },
		},
		"/downloads": {
			get: { tags: ["下载站"], summary: "获取下载任务列表", responses: { "200": { description: "任务列表" } } },
			post: { tags: ["下载站"], summary: "创建下载任务", responses: { "200": { description: "已创建" } } },
		},
		"/images/upload": {
			post: { tags: ["图床"], summary: "上传图片", requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } }, responses: { "200": { description: "上传成功" } } },
		},
		"/images/list": {
			get: { tags: ["图床"], summary: "获取图片列表", responses: { "200": { description: "图片列表" } } },
		},
		"/docker/containers": {
			get: { tags: ["Docker"], summary: "列出容器", parameters: [{ name: "id", in: "query", schema: { type: "string" }, description: "容器ID(查单个)" }, { name: "logs", in: "query", schema: { type: "string" }, description: "获取日志的容器ID" }], responses: { "200": { description: "容器列表" } } },
			post: { tags: ["Docker"], summary: "容器操作(start/stop/restart/remove)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["id", "action"], properties: { id: { type: "string" }, action: { type: "string", enum: ["start", "stop", "restart", "remove"] } } } } } }, responses: { "200": { description: "操作完成" } } },
		},
		"/monitoring/stats": {
			get: { tags: ["监控"], summary: "获取系统监控数据(CPU/内存/磁盘/网络)", responses: { "200": { description: "监控数据" } } },
		},
		"/users": {
			get: { tags: ["用户"], summary: "获取用户列表", responses: { "200": { description: "用户列表" } } },
			post: { tags: ["用户"], summary: "创建用户", responses: { "200": { description: "已创建" } } },
		},
		"/users/permissions": {
			get: { tags: ["用户"], summary: "获取权限列表", responses: { "200": { description: "权限列表" } } },
		},
		"/audit": {
			get: { tags: ["审计"], summary: "获取审计日志", parameters: [{ name: "page", in: "query", schema: { type: "integer" } }, { name: "pageSize", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "审计日志列表" } } },
		},
		"/notifications": {
			get: { tags: ["通知"], summary: "获取通知列表", responses: { "200": { description: "通知列表" } } },
		},
		"/quick-services": {
			get: { tags: ["快服务"], summary: "获取快服务列表", responses: { "200": { description: "快服务列表" } } },
		},
		"/snippets": {
			get: { tags: ["代码片段"], summary: "获取代码片段列表", responses: { "200": { description: "片段列表" } } },
			post: { tags: ["代码片段"], summary: "创建代码片段", responses: { "200": { description: "已创建" } } },
		},
		"/backups": {
			get: { tags: ["备份"], summary: "获取备份列表", responses: { "200": { description: "备份列表" } } },
			post: { tags: ["备份"], summary: "创建备份", responses: { "200": { description: "已创建" } } },
		},
		"/dashboard/analytics": {
			get: { tags: ["系统"], summary: "仪表盘图表数据", parameters: [{ name: "type", in: "query", schema: { type: "string", enum: ["servers", "downloads", "audit", "image-bed"] } }], responses: { "200": { description: "图表数据" } } },
		},
		"/system-health": {
			get: { tags: ["系统"], summary: "系统健康检查", responses: { "200": { description: "健康状态" } } },
		},
		"/health": {
			get: { tags: ["系统"], summary: "基本健康检查", responses: { "200": { description: "OK" } } },
		},
		"/settings": {
			get: { tags: ["系统"], summary: "获取系统设置", responses: { "200": { description: "设置" } } },
			put: { tags: ["系统"], summary: "更新系统设置", responses: { "200": { description: "已更新" } } },
		},
		"/status": {
			get: { tags: ["系统"], summary: "获取系统状态", responses: { "200": { description: "状态信息" } } },
		},
	},
	components: {
		securitySchemes: {
			cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
		},
	},
	security: [{ cookieAuth: [] }],
};

export async function GET() {
	return NextResponse.json(spec);
}
