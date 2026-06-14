import { prisma } from "@/lib/db";

/* ── Types ────────────────────────────────────────────────── */

export type CreateTemplateInput = {
	name: string;
	description?: string;
	command: string;
	rollbackCommand?: string | null;
	variables?: string[];
	tags?: string[];
	createdById?: string;
};

export type UpdateTemplateInput = Partial<CreateTemplateInput>;

/* ── Extract variables from command ───────────────────────── */

export function extractVariables(command: string): string[] {
	const matches = command.match(/\{\{(\w+)\}\}/g);
	if (!matches) return [];
	return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
}

export function extractTemplateVariables(command: string, rollbackCommand?: string | null): string[] {
	return [...new Set([...extractVariables(command), ...extractVariables(rollbackCommand || "")])];
}

/* ── Render command with variables ────────────────────────── */

export function renderCommand(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result;
}

/* ── Built-in templates ───────────────────────────────────── */

export const BUILTIN_TEMPLATES: CreateTemplateInput[] = [
	{ name: "Nginx 重启", command: "systemctl restart nginx", tags: ["web", "nginx"], description: "平滑重启 Nginx 服务" },
	{ name: "Nginx 配置测试", command: "nginx -t", tags: ["web", "nginx"], description: "测试 Nginx 配置文件语法" },
	{ name: "Docker 清理未使用资源", command: "docker system prune -af", tags: ["docker", "cleanup"], description: "删除所有未使用的容器、网络、镜像" },
	{ name: "Docker Compose 拉取更新", command: "cd {{project_dir}} && docker compose pull && docker compose up -d", tags: ["docker"], description: "拉取最新镜像并重启容器", variables: ["project_dir"] },
	{ name: "磁盘使用 Top 10", command: "du -ah / 2>/dev/null | sort -rh | head -10", tags: ["disk", "debug"], description: "查看磁盘占用最大的 10 个目录/文件" },
	{ name: "清理日志文件", command: "find /var/log -name '*.log' -mtime +{{days}} -delete", tags: ["cleanup", "log"], description: "清理超过指定天数的旧日志", variables: ["days"] },
	{ name: "SSL 证书续签", command: "certbot renew --quiet", tags: ["ssl", "certbot"], description: "自动续签 Let's Encrypt 证书" },
	{ name: "系统更新", command: "apt update && apt upgrade -y", tags: ["system", "update"], description: "更新系统所有软件包" },
	{ name: "查看端口监听", command: "ss -tlnp | grep :{{port}}", tags: ["network", "debug"], description: "检查指定端口是否在监听", variables: ["port"] },
	{ name: "查看进程内存占用", command: "ps aux --sort=-%mem | head -{{count}}", tags: ["process", "debug"], description: "查看内存占用最高的进程", variables: ["count"] },
	{ name: "防火墙放行端口", command: "ufw allow {{port}}/tcp && ufw reload", tags: ["firewall", "ufw"], description: "UFW 放行指定 TCP 端口", variables: ["port"] },
	{ name: "查看服务状态", command: "systemctl status {{service}}", tags: ["system", "service"], description: "查看 systemd 服务状态", variables: ["service"] },
];

/* ── Seed built-in templates ──────────────────────────────── */

export async function seedBuiltinTemplates() {
	const existing = await prisma.commandTemplate.count({ where: { isBuiltin: true } });
	if (existing > 0) return;

	// TR-040: parallelize the 12 built-in inserts with a single `createMany`
	// round-trip so a fresh DB seed completes in one DB call instead of
	// 12 sequential `prisma.commandTemplate.create` round-trips.
	await prisma.commandTemplate.createMany({
		data: BUILTIN_TEMPLATES.map((tmpl) => ({
			name: tmpl.name,
			description: tmpl.description ?? null,
			command: tmpl.command,
			rollbackCommand: tmpl.rollbackCommand ?? null,
			variables: tmpl.variables ?? extractTemplateVariables(tmpl.command, tmpl.rollbackCommand),
			tags: tmpl.tags ?? [],
			isBuiltin: true,
		})),
	});
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function listTemplates(limit = 200) {
	await seedBuiltinTemplates();
	return prisma.commandTemplate.findMany({
		orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
		take: limit,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function createTemplate(input: CreateTemplateInput) {
	return prisma.commandTemplate.create({
		data: {
			name: input.name,
			description: input.description ?? null,
			command: input.command,
			rollbackCommand: input.rollbackCommand?.trim() || null,
			variables: input.variables ?? extractTemplateVariables(input.command, input.rollbackCommand),
			tags: input.tags ?? [],
			isBuiltin: false,
			createdById: input.createdById ?? null,
		},
	});
}

export async function updateTemplate(id: string, input: UpdateTemplateInput) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.description !== undefined) data.description = input.description;
	if (input.command !== undefined || input.rollbackCommand !== undefined) {
		const existing = input.command !== undefined && input.rollbackCommand !== undefined
			? null
			: await prisma.commandTemplate.findUnique({ where: { id }, select: { command: true, rollbackCommand: true } });
		const command = input.command ?? existing?.command ?? "";
		const rollbackCommand = input.rollbackCommand !== undefined ? input.rollbackCommand : existing?.rollbackCommand;
		if (input.command !== undefined) data.command = input.command;
		if (input.rollbackCommand !== undefined) data.rollbackCommand = input.rollbackCommand?.trim() || null;
		data.variables = input.variables ?? extractTemplateVariables(command, rollbackCommand);
	}
	if (input.tags !== undefined) data.tags = input.tags;
	return prisma.commandTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string) {
	return prisma.commandTemplate.delete({ where: { id } });
}
