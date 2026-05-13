import { prisma } from "@/lib/db";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import net from "net";

const run = promisify(exec);

/* ── 安全辅助函数 ─────────────────────────────────────────────── */

/** Shell 参数安全引用（单引号版本） */
function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

/** 容器名安全验证：只允许字母、数字、下划线、点、连字符 */
const SAFE_CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function safeContainerName(slug: string): string {
	if (!SAFE_CONTAINER_RE.test(slug)) throw new Error('Invalid slug');
	return `qs-${slug}`;
}

/* ── Port allocation & detection ──────────────────────────────── */

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 65535;
const PORT_MAX_ATTEMPTS = 50;

/** Actually do a synchronous bind check (the reliable one) */
export function isPortAvailableSync(port: number): boolean {
	try {
		const result = execSync(
			`node -e "const n=require('net');const s=n.createServer();s.on('error',()=>{process.exit(1)});s.listen(${port},'0.0.0.0',()=>{s.close();process.exit(0)})"`,
			{ timeout: 5000 },
		);
		return true;
	} catch {
		return false;
	}
}

/** Allocate a random free port in the high range */
export function allocatePort(preferredPort?: number): number {
	// If caller wants a specific port, try it first
	if (preferredPort) {
		if (isPortAvailableSync(preferredPort)) return preferredPort;
		// preferred port taken → fall through to random
	}

	const tried = new Set<number>();
	for (let i = 0; i < PORT_MAX_ATTEMPTS; i++) {
		const port = PORT_RANGE_MIN + Math.floor(Math.random() * (PORT_RANGE_MAX - PORT_RANGE_MIN + 1));
		if (tried.has(port)) continue;
		tried.add(port);
		if (isPortAvailableSync(port)) return port;
	}
	throw new Error("无法分配可用端口，请手动指定端口后重试");
}

/** Get list of all currently used listening ports (for UI hints) */
export function getUsedPorts(): number[] {
	try {
		const out = execSync(`ss -tlnpH 2>/dev/null | grep -oP 'LISTEN.*?:\\K\\d+' || ss -tlnp 2>/dev/null | grep -oP ':\\K\\d+' | sort -un`, {
			timeout: 5000,
			encoding: "utf8",
		});
		return out.trim().split("\n").map(Number).filter((n) => !isNaN(n));
	} catch {
		return [];
	}
}


import type { ServiceTemplate } from "./types";
import { SERVICE_CATALOG } from "./catalog";

// Re-export for backward compatibility
export type { ServiceTemplate } from "./types";
export { SERVICE_CATALOG } from "./catalog";


/* ── CRUD ──────────────────────────────────────────────────────── */

export async function listQuickServices() {
	return prisma.quickService.findMany({
		orderBy: [{ category: "asc" }, { name: "asc" }],
		select: { id: true, slug: true, name: true, category: true, description: true, icon: true, image: true, port: true, path: true, envJson: true, volumesJson: true, status: true, containerId: true, error: true, createdAt: true },
	});
}

export async function getQuickService(slug: string) {
	return prisma.quickService.findUnique({
		where: { slug },
		select: { id: true, slug: true, name: true, category: true, description: true, icon: true, image: true, port: true, path: true, envJson: true, volumesJson: true, status: true, containerId: true, error: true, createdAt: true },
	});
}

/* ── Install: create DB record + run docker ────────────────────── */

export interface InstallOptions {
	template: ServiceTemplate;
	userId?: string;
	/** User-specified port; if omitted, auto-allocate from high range */
	customPort?: number;
}

export async function installService(opts: InstallOptions) {
	const { template, userId, customPort } = opts;

	// ── Step 1: Resolve the actual host port ──
	const hostPort = customPort ?? allocatePort(template.defaultPort);

	// ── Step 2: Real-time port availability check ──
	if (!isPortAvailableSync(hostPort)) {
		throw new Error(`端口 ${hostPort} 已被占用，无法部署。请更换端口后重试。`);
	}

	// ── Step 3: Create volume dirs ──
	for (const vol of template.volumesJson) {
		try {
			execSync(`mkdir -p ${shellQuote(vol.host)}`, { timeout: 10000 });
		} catch {
			// best effort
		}
	}

	// ── Step 4: Create DB record (installing state) ──
	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const svc = await prisma.quickService.upsert({
		where: { slug: template.slug },
		update: {
			status: "installing",
			image: template.image,
			port: hostPort,
			path: template.path,
			envJson: envStr,
			volumesJson: volStr,
			error: null,
		},
		create: {
			slug: template.slug,
			name: template.name,
			category: template.category,
			icon: template.icon,
			description: template.description,
			image: template.image,
			port: hostPort,
			path: template.path,
			envJson: envStr,
			volumesJson: volStr,
			status: "installing",
			createdBy: userId ?? null,
		},
	});

	// ── Step 5: Run docker in background ──
	startDockerContainer(svc.id, template, hostPort).catch(async (err) => {
		const msg = err instanceof Error ? err.message : String(err);
		await prisma.quickService.update({ where: { id: svc.id }, data: { status: "error", error: msg } });
	});

	return { ...svc, port: hostPort };
}

async function startDockerContainer(serviceId: string, tmpl: ServiceTemplate, hostPort: number) {
	const containerName = safeContainerName(tmpl.slug);

	// Stop & remove old container if exists
	try {
		execSync(`docker rm -f ${shellQuote(containerName)} 2>/dev/null`, { timeout: 15000 });
	} catch {
		// doesn't exist, fine
	}

	// Build docker run command
	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const portMapping = `-p ${hostPort}:${internalPort}`;
	const extraPortMappings = (tmpl.extraPorts ?? [])
		.map((ep) => `-p ${ep.host}:${ep.container}`)
		.join(" ");
	const volArgs = tmpl.volumesJson.map((v) => `-v ${shellQuote(v.host)}:${shellQuote(v.container)}`).join(" ");
	const envArgs = Object.entries(tmpl.envJson)
		.filter(([, v]) => v !== "")
		.map(([k, v]) => `-e ${k}=${shellQuote(String(v))}`)
		.join(" ");
	const cmdSuffix = tmpl.command ? ` ${tmpl.command}` : "";

	const cmd = `docker run -d --name ${shellQuote(containerName)} --restart unless-stopped ${portMapping} ${extraPortMappings} ${volArgs} ${envArgs} ${tmpl.image}${cmdSuffix}`;

	const { stdout } = await run(cmd, { timeout: 300_000 }); // 5min for image pull
	const containerId = stdout.trim().substring(0, 12);

	await prisma.quickService.update({
		where: { id: serviceId },
		data: { status: "running", containerId, error: null },
	});
}

/* ── Uninstall: stop + remove container + delete DB ─────────────── */

export async function uninstallService(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = safeContainerName(svc.slug);
	try {
		execSync(`docker rm -f ${shellQuote(containerName)} 2>/dev/null`, { timeout: 15000 });
	} catch {
		// container may not exist
	}

	await prisma.quickService.delete({ where: { slug } });
}

/* ── Start / Stop ──────────────────────────────────────────────── */

export async function startService(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = safeContainerName(svc.slug);
	try {
		execSync(`docker start ${shellQuote(containerName)}`, { timeout: 30000 });
		await prisma.quickService.update({ where: { slug }, data: { status: "running" } });
	} catch {
		// Container may have been removed; try to re-create from DB info
		const tmpl: ServiceTemplate = {
			slug: svc.slug,
			name: svc.name,
			category: svc.category,
			icon: svc.icon,
			description: svc.description,
			image: svc.image,
			defaultPort: svc.port,
			path: svc.path,
			envJson: JSON.parse(svc.envJson),
			volumesJson: JSON.parse(svc.volumesJson),
		};
		await startDockerContainer(svc.id, tmpl, svc.port);
	}
}

export async function stopService(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = safeContainerName(svc.slug);
	try {
		execSync(`docker stop ${shellQuote(containerName)}`, { timeout: 30000 });
		await prisma.quickService.update({ where: { slug }, data: { status: "stopped" } });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await prisma.quickService.update({ where: { slug }, data: { status: "error", error: msg } });
		throw new Error(`停止失败: ${msg}`);
	}
}

/* ── Sync container status from Docker ──────────────────────────── */

export async function syncServiceStatus(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = safeContainerName(svc.slug);
	try {
		const state = execSync(`docker inspect --format='{{.State.Status}}' ${shellQuote(containerName)} 2>/dev/null`, { timeout: 10000 }).toString().trim();
		const status = state === "running" ? "running" : state === "paused" ? "stopped" : "stopped";
		await prisma.quickService.update({ where: { slug }, data: { status, error: null } });
		return status;
	} catch {
		await prisma.quickService.update({ where: { slug }, data: { status: "stopped" } });
		return "stopped";
	}
}

/* ── Port check API helper ─────────────────────────────────────── */

/** Check if a specific port is available; returns { available, usedBy } */
export function checkPort(port: number): { available: boolean; usedBy: string | null } {
	// 确保 port 是安全整数，防止注入
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { available: false, usedBy: null };
	}
	try {
		const out = execSync(
			`ss -tlnpH 2>/dev/null | grep ':${port}\\b' || true`,
			{ timeout: 5000, encoding: "utf8" },
		);
		if (out.trim()) {
			// Try to extract process name
			const pidMatch = out.match(/pid=(\d+)/);
			let usedBy = "未知进程";
			if (pidMatch) {
				const pid = pidMatch[1];
				if (!/^\d+$/.test(pid)) throw new Error('Invalid PID');
				try {
					const cmdLine = execSync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' '`, {
						timeout: 3000,
						encoding: "utf8",
					});
					usedBy = cmdLine.trim().substring(0, 80) || `PID ${pid}`;
				} catch {
					usedBy = `PID ${pid}`;
				}
			}
			return { available: false, usedBy };
		}
		return { available: true, usedBy: null };
	} catch {
		return { available: true, usedBy: null };
	}
}
