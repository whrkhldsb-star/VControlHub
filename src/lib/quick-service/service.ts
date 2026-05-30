import { mkdirSync } from "node:fs";
import { execFile, execFileSync, execSync } from "child_process";
import { promisify } from "util";

import { prisma } from "@/lib/db";
import type { ServiceTemplate } from "./types";

const runFile = promisify(execFile);
const serviceOperationLocks = new Set<string>();

async function withServiceOperationLock<T>(slug: string, _operation: string, fn: () => Promise<T>): Promise<T> {
	const normalizedSlug = slug.trim();
	if (serviceOperationLocks.has(normalizedSlug)) {
		throw new Error(`服务 ${normalizedSlug} 正在执行其它操作，请稍后重试`);
	}
	serviceOperationLocks.add(normalizedSlug);
	try {
		return await fn();
	} finally {
		serviceOperationLocks.delete(normalizedSlug);
	}
}

function assertServiceNotBusy(svc: { slug: string; status?: string | null }, operation: string) {
	if (svc.status === "installing") {
		throw new Error(`服务 ${svc.slug} 正在安装中，无法${operation}，请稍后重试`);
	}
}

// Re-export for backward compatibility
export type { ServiceTemplate } from "./types";

/* -- Safety helpers ------------------------------------------------------ */

const SAFE_CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SAFE_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_IMAGE_RE = /^(?:[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*)*(?::[A-Za-z0-9_.-]{1,128}|@[A-Za-z0-9_+.-]+:[A-Fa-f0-9=:]+)?$/;
const SAFE_VOLUME_OPTION_RE = /^(?:ro|rw|z|Z|cached|delegated|consistent|rshared|rslave|rprivate|shared|slave|private)$/;
const HOST_VOLUME_ROOTS = ["/opt/", "/srv/"];
const TRUSTED_HOST_MOUNTS = new Set(["/etc/timezone", "/etc/localtime"]);
const DOCKER_SOCKET = "/var/run/docker.sock";

function safeContainerName(slug: string): string {
	if (!SAFE_CONTAINER_RE.test(slug)) throw new Error("服务标识无效");
	return `qs-${slug}`;
}

function assertTcpPort(port: number, label = "端口") {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${label} ${port} 无效，请使用 1-65535 范围内的端口。`);
	}
}

function assertImage(image: string) {
	if (!SAFE_IMAGE_RE.test(image)) throw new Error("镜像名称无效");
}

function normalizeVolumeEndpoint(value: string, label: string) {
	const trimmed = value.trim();
	if (!trimmed.startsWith("/") || trimmed.includes("\0") || trimmed.includes("..")) {
		throw new Error(`${label} 路径无效`);
	}
	return trimmed.replace(/\/+$/, "") || "/";
}

function splitContainerPathAndOptions(raw: string) {
	const [containerPath, ...options] = raw.split(":");
	const normalizedPath = normalizeVolumeEndpoint(containerPath, "容器挂载");
	for (const option of options) {
		if (!SAFE_VOLUME_OPTION_RE.test(option)) throw new Error(`挂载选项 ${option} 无效`);
	}
	return [normalizedPath, ...options].join(":");
}

function assertHostVolumeAllowed(hostPath: string, template: ServiceTemplate) {
	if (hostPath === DOCKER_SOCKET) {
		if (template.allowDockerSocket === true) return;
		throw new Error("远程应用不允许挂载 Docker socket");
	}
	if (TRUSTED_HOST_MOUNTS.has(hostPath)) return;
	if (HOST_VOLUME_ROOTS.some((root) => hostPath === root.slice(0, -1) || hostPath.startsWith(root))) return;
	throw new Error(`宿主机挂载路径 ${hostPath} 不在允许范围内`);
}

function validateTemplate(template: ServiceTemplate) {
	safeContainerName(template.slug);
	assertImage(template.image);
	assertTcpPort(template.defaultPort, "默认端口");
	if (template.internalPort !== undefined) assertTcpPort(template.internalPort, "容器端口");
	for (const ep of template.extraPorts ?? []) {
		assertTcpPort(ep.host, "额外端口");
		assertTcpPort(ep.container, "额外容器端口");
	}
	for (const key of Object.keys(template.envJson)) {
		if (!SAFE_ENV_KEY_RE.test(key)) throw new Error(`环境变量名 ${key} 无效`);
	}
	for (const vol of template.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "宿主机挂载");
		assertHostVolumeAllowed(host, template);
		splitContainerPathAndOptions(vol.container);
	}
}

function parseCommandArgs(command?: string): string[] {
	if (!command?.trim()) return [];
	const args: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;
	for (const ch of command) {
		if (escaping) {
			current += ch;
			escaping = false;
			continue;
		}
		if (ch === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (escaping || quote) throw new Error("启动命令格式无效");
	if (current) args.push(current);
	return args;
}

function resolveEnvValue(value: string) {
	return value === "127.0.0.1" || value === "localhost" ? "host.docker.internal" : value;
}

function dockerExecSync(args: string[], timeout = 30_000) {
	return execFileSync("docker", args, { timeout, encoding: "utf8" });
}

export function getDockerEnvironmentStatus() {
	try {
		const version = execFileSync("docker", ["--version"], { timeout: 5_000, encoding: "utf8" }).trim();
		execFileSync("docker", ["info"], { timeout: 10_000, stdio: "pipe" });
		return { available: true, running: true, version, message: null as string | null, installHint: null as string | null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const notInstalled = /ENOENT|not found|no such file/i.test(message);
		return {
			available: false,
			running: false,
			version: null as string | null,
			message: notInstalled ? "Docker 未安装" : "Docker 未运行或当前用户无权限访问 Docker daemon",
			installHint: "快捷服务依赖 Docker。请先执行 curl -fsSL https://get.docker.com | sh，并确认 systemctl enable --now docker。",
		};
	}
}

/* -- Port allocation & detection --------------------------------------- */

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 65535;
const PORT_MAX_ATTEMPTS = 50;

export function isPortAvailableSync(port: number): boolean {
	assertTcpPort(port);
	try {
		execFileSync(
			"node",
			[
				"-e",
				"const n=require('net');const p=Number(process.argv[1]);const s=n.createServer();s.on('error',()=>process.exit(1));s.listen(p,'0.0.0.0',()=>s.close(()=>process.exit(0)))",
				String(port),
			],
			{ timeout: 5000 },
		);
		return true;
	} catch {
		return false;
	}
}

export function allocatePort(preferredPort?: number): number {
	if (preferredPort) {
		assertTcpPort(preferredPort);
		if (isPortAvailableSync(preferredPort)) return preferredPort;
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

function assertPortAvailable(port: number, label = "端口") {
	assertTcpPort(port, label);
	if (!isPortAvailableSync(port)) {
		throw new Error(`${label} ${port} 已被占用，请更换端口后重试。`);
	}
}

function assertTemplatePortsAvailable(template: ServiceTemplate, hostPort: number) {
	assertPortAvailable(hostPort, "端口");
	for (const ep of template.extraPorts ?? []) {
		assertPortAvailable(ep.host, "额外端口");
	}
}

/* -- CRUD --------------------------------------------------------------- */

export async function listQuickServices() {
	return prisma.quickService.findMany({
		orderBy: [{ category: "asc" }, { name: "asc" }],
		select: { id: true, slug: true, name: true, category: true, description: true, icon: true, image: true, port: true, path: true, internalPort: true, extraPortsJson: true, command: true, envJson: true, volumesJson: true, status: true, containerId: true, error: true, createdAt: true },
	});
}

export async function getQuickService(slug: string) {
	return prisma.quickService.findUnique({
		where: { slug },
		select: { id: true, slug: true, name: true, category: true, description: true, icon: true, image: true, port: true, path: true, internalPort: true, extraPortsJson: true, command: true, envJson: true, volumesJson: true, status: true, containerId: true, error: true, createdAt: true },
	});
}

export interface InstallOptions {
	template: ServiceTemplate;
	userId?: string;
	customPort?: number;
}

export async function installService(opts: InstallOptions) {
	const { template } = opts;
	return withServiceOperationLock(template.slug, "安装", () => installServiceUnlocked(opts));
}

async function installServiceUnlocked(opts: InstallOptions) {
	const { template, userId, customPort } = opts;

	// Pre-flight: ensure Docker is available
	const dockerStatus = getDockerEnvironmentStatus();
	if (!dockerStatus.available) {
		throw new Error(`${dockerStatus.message}。${dockerStatus.installHint}`);
	}

	validateTemplate(template);
	const hostPort = customPort ?? allocatePort(template.defaultPort);
	assertTemplatePortsAvailable(template, hostPort);

	for (const vol of template.volumesJson) {
		const host = normalizeVolumeEndpoint(vol.host, "宿主机挂载");
		if (host !== DOCKER_SOCKET && !TRUSTED_HOST_MOUNTS.has(host)) {
			mkdirSync(host, { recursive: true });
		}
	}

	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const extraPortsStr = JSON.stringify(template.extraPorts ?? []);
	const svc = await prisma.quickService.upsert({
		where: { slug: template.slug },
		update: {
			status: "installing",
			image: template.image,
			port: hostPort,
			path: template.path,
			internalPort: template.internalPort ?? null,
			extraPortsJson: extraPortsStr,
			command: template.command ?? null,
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
			internalPort: template.internalPort ?? null,
			extraPortsJson: extraPortsStr,
			command: template.command ?? null,
			envJson: envStr,
			volumesJson: volStr,
			status: "installing",
			createdBy: userId ?? null,
		},
	});

	startDockerContainer(svc.id, template, hostPort).catch(async (err) => {
		const msg = err instanceof Error ? err.message : String(err);
		await prisma.quickService.update({ where: { id: svc.id }, data: { status: "error", error: msg } });
	});

	return { ...svc, port: hostPort };
}

async function startDockerContainer(serviceId: string, tmpl: ServiceTemplate, hostPort: number) {
	validateTemplate(tmpl);
	const containerName = safeContainerName(tmpl.slug);

	try {
		dockerExecSync(["rm", "-f", containerName], 15_000);
	} catch {
		// Container does not exist; continue.
	}

	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const args = [
		"run",
		"-d",
		"--name",
		containerName,
		"--restart",
		"unless-stopped",
		"--add-host=host.docker.internal:host-gateway",
		"-p",
		`${hostPort}:${internalPort}`,
	];
	for (const ep of tmpl.extraPorts ?? []) args.push("-p", `${ep.host}:${ep.container}`);
	for (const vol of tmpl.volumesJson) args.push("-v", `${normalizeVolumeEndpoint(vol.host, "宿主机挂载")}:${splitContainerPathAndOptions(vol.container)}`);
	for (const [key, value] of Object.entries(tmpl.envJson)) {
		if (value !== "") args.push("-e", `${key}=${resolveEnvValue(String(value))}`);
	}
	args.push(tmpl.image, ...parseCommandArgs(tmpl.command));

	const { stdout } = await runFile("docker", args, { timeout: 300_000 });
	const containerId = stdout.trim().substring(0, 12);

	await prisma.quickService.update({
		where: { id: serviceId },
		data: { status: "running", containerId, error: null },
	});
}

export async function uninstallService(slug: string) {
	return withServiceOperationLock(slug, "卸载", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "卸载");

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["rm", "-f", containerName], 15_000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error: `卸载失败: ${msg}` } });
			throw new Error(`卸载失败: ${msg}`);
		}

		await prisma.quickService.delete({ where: { slug } });
	});
}

export async function startService(slug: string) {
	return withServiceOperationLock(slug, "启动", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "启动");

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["start", containerName], 30_000);
			await prisma.quickService.update({ where: { slug }, data: { status: "running", error: null } });
		} catch {
			const tmpl: ServiceTemplate = {
				slug: svc.slug,
				name: svc.name,
				category: svc.category,
				icon: svc.icon,
				description: svc.description,
				image: svc.image,
				defaultPort: svc.port,
				internalPort: svc.internalPort ?? undefined,
				path: svc.path,
				envJson: JSON.parse(svc.envJson),
				volumesJson: JSON.parse(svc.volumesJson),
				extraPorts: JSON.parse(svc.extraPortsJson || "[]"),
				command: svc.command ?? undefined,
			};
			try {
				await startDockerContainer(svc.id, tmpl, svc.port);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				await prisma.quickService.update({ where: { slug }, data: { status: "error", error: msg } });
				throw new Error(`启动失败: ${msg}`);
			}
		}
	});
}

export async function stopService(slug: string) {
	return withServiceOperationLock(slug, "停止", async () => {
		const svc = await prisma.quickService.findUnique({ where: { slug } });
		if (!svc) throw new Error("服务不存在");
		assertServiceNotBusy(svc, "停止");

		const containerName = safeContainerName(svc.slug);
		try {
			dockerExecSync(["stop", containerName], 30_000);
			await prisma.quickService.update({ where: { slug }, data: { status: "stopped", error: null } });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await prisma.quickService.update({ where: { slug }, data: { status: "error", error: msg } });
			throw new Error(`停止失败: ${msg}`);
		}
	});
}

export async function syncServiceStatus(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = safeContainerName(svc.slug);
	try {
		const state = dockerExecSync(["inspect", "--format={{.State.Status}}", containerName], 10_000).trim();
		const status = state === "running" ? "running" : "stopped";
		await prisma.quickService.update({ where: { slug }, data: { status, error: null } });
		return status;
	} catch {
		await prisma.quickService.update({ where: { slug }, data: { status: "stopped" } });
		return "stopped";
	}
}

export function checkPort(port: number): { available: boolean; usedBy: string | null } {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { available: false, usedBy: null };
	}
	try {
		const out = execSync(
			`ss -tlnpH 2>/dev/null | grep ':${port}\\b' || true`,
			{ timeout: 5000, encoding: "utf8" },
		);
		if (out.trim()) {
			const pidMatch = out.match(/pid=(\d+)/);
			let usedBy = "未知进程";
			if (pidMatch) {
				const pid = pidMatch[1];
				if (!/^\d+$/.test(pid)) throw new Error("Invalid PID");
				try {
					const cmdLine = execFileSync("tr", ["\0", " ", `/proc/${pid}/cmdline`], {
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
