import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";

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
	{ name: "Nginx Restart", command: "systemctl restart nginx", tags: ["web", "nginx"], description: "Gracefully restart Nginx service (systemd)" },
	{ name: "Nginx Config Test", command: "nginx -t", tags: ["web", "nginx"], description: "Test Nginx configuration file syntax" },
	{ name: "Docker Prune Unused Resources", command: "docker system prune -af", tags: ["docker", "cleanup"], description: "Remove all unused containers, networks, images" },
	{ name: "Docker Compose Pull & Update", command: "cd {{project_dir}} && docker compose pull && docker compose up -d", tags: ["docker"], description: "Pull latest images and restart containers", variables: ["project_dir"] },
	{ name: "Disk Usage Top 10", command: "du -ah / 2>/dev/null | sort -rh | head -10", tags: ["disk", "debug"], description: "Show the 10 largest directories/files by disk usage" },
	{ name: "Clean Log Files", command: "find /var/log -name '*.log' -mtime +{{days}} -delete", tags: ["cleanup", "log"], description: "Clean old logs older than the specified number of days", variables: ["days"] },
	{ name: "SSL Certificate Renewal", command: "certbot renew --quiet", tags: ["ssl", "certbot"], description: "Automatically renew Let's Encrypt certificates" },
	{ name: "System Update", command: "apt update && apt upgrade -y", tags: ["system", "update", "debian"], description: "Update all system packages (Debian/Ubuntu apt)" },
	{ name: "Check Port Listening", command: "ss -tlnp | grep :{{port}}", tags: ["network", "debug"], description: "Check if the specified port is listening", variables: ["port"] },
	{ name: "Check Process Memory Usage", command: "ps aux --sort=-%mem | head -{{count}}", tags: ["process", "debug"], description: "Show processes with the highest memory usage", variables: ["count"] },
	{ name: "Firewall Allow Port", command: "ufw allow {{port}}/tcp && ufw reload", tags: ["firewall", "ufw"], description: "UFW allow specified TCP port", variables: ["port"] },
	{ name: "Check Service Status", command: "systemctl status {{service}}", tags: ["system", "service", "systemd"], description: "Check systemd service status", variables: ["service"] },
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

export type TemplateActor = {
	userId?: string | null;
	/** Admin / role:manage may mutate any non-builtin template. */
	canManageAll?: boolean;
};

function assertCanMutateTemplate(
	existing: { isBuiltin: boolean; createdById: string | null },
	actor?: TemplateActor,
) {
	if (existing.isBuiltin) {
		throw new BusinessError("Built-in command templates cannot be modified");
	}
	if (actor?.canManageAll) return;
	if (existing.createdById && actor?.userId && existing.createdById === actor.userId) return;
	// Legacy rows with null creator: only managers may mutate (avoid open edit by any command:create holder).
	if (!existing.createdById && actor?.canManageAll) return;
	throw new ForbiddenError("No permission to modify others' command templates");
}

export async function updateTemplate(id: string, input: UpdateTemplateInput, actor?: TemplateActor) {
	const existingRow = await prisma.commandTemplate.findUnique({
		where: { id },
		select: { id: true, isBuiltin: true, command: true, rollbackCommand: true, createdById: true },
	});
	if (!existingRow) {
		throw new NotFoundError("Command template not found");
	}
	if (existingRow.isBuiltin) {
		throw new BusinessError("Built-in command templates cannot be modified");
	}
	assertCanMutateTemplate(existingRow, actor);

	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.description !== undefined) data.description = input.description;
	if (input.command !== undefined || input.rollbackCommand !== undefined) {
		const command = input.command ?? existingRow.command ?? "";
		const rollbackCommand =
			input.rollbackCommand !== undefined ? input.rollbackCommand : existingRow.rollbackCommand;
		if (input.command !== undefined) data.command = input.command;
		if (input.rollbackCommand !== undefined) data.rollbackCommand = input.rollbackCommand?.trim() || null;
		data.variables = input.variables ?? extractTemplateVariables(command, rollbackCommand);
	}
	if (input.tags !== undefined) data.tags = input.tags;
	return prisma.commandTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string, actor?: TemplateActor) {
	const existingRow = await prisma.commandTemplate.findUnique({
		where: { id },
		select: { id: true, name: true, isBuiltin: true, tags: true, variables: true, createdById: true },
	});
	if (!existingRow) {
		throw new NotFoundError("Command template not found");
	}
	if (existingRow.isBuiltin) {
		throw new BusinessError("Built-in command templates cannot be deleted");
	}
	assertCanMutateTemplate(existingRow, actor);
	await prisma.commandTemplate.delete({ where: { id } });
	return existingRow;
}
