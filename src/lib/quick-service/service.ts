import { prisma } from "@/lib/db";
import { execSync, exec } from "child_process";
import { promisify } from "util";

const run = promisify(exec);

/* ── Service catalog (built-in templates) ─────────────────────── */

export interface ServiceTemplate {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	port: number;
	path: string;
	envJson: Record<string, string>;
	volumesJson: Array<{ host: string; container: string }>;
}

export const SERVICE_CATALOG: ServiceTemplate[] = [
	{
		slug: "alist",
		name: "AList 云盘",
		category: "storage",
		icon: "☁️",
		description: "支持多种存储的文件列表程序，可挂载阿里云盘、OneDrive、S3等",
		image: "xhofe/alist:latest",
		port: 5244,
		path: "/files-proxy/",
		envJson: { PUID: "0", PGID: "0", UMASK: "022" },
		volumesJson: [{ host: "/opt/alist/data", container: "/opt/alist/data" }],
	},
	{
		slug: "emby",
		name: "Emby 影视",
		category: "media",
		icon: "🎬",
		description: "强大的媒体服务器，管理和串流你的电影、电视剧和音乐",
		image: "emby/embyserver:latest",
		port: 8096,
		path: "/web/index.html",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [
			{ host: "/opt/emby/config", container: "/config" },
			{ host: "/opt/emby/data", container: "/data" },
		],
	},
	{
		slug: "jellyfin",
		name: "Jellyfin 影视",
		category: "media",
		icon: "📺",
		description: "开源免费的媒体系统，Emby/Plex 的开源替代",
		image: "jellyfin/jellyfin:latest",
		port: 8097,
		path: "/jellyfin/",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [
			{ host: "/opt/jellyfin/config", container: "/config" },
			{ host: "/opt/jellyfin/cache", container: "/cache" },
			{ host: "/opt/jellyfin/media", container: "/media" },
		],
	},
	{
		slug: "nextcloud",
		name: "Nextcloud 网盘",
		category: "storage",
		icon: "📁",
		description: "自托管的私有云存储和协作平台",
		image: "nextcloud:latest",
		port: 8080,
		path: "/nextcloud/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/nextcloud/html", container: "/var/www/html" },
			{ host: "/opt/nextcloud/data", container: "/var/www/html/data" },
		],
	},
	{
		slug: "gitea",
		name: "Gitea Git",
		category: "devtools",
		icon: "🔨",
		description: "轻量级自托管 Git 服务，类似 GitHub/GitLab",
		image: "gitea/gitea:latest",
		port: 3002,
		path: "/gitea/",
		envJson: { USER_UID: "0", USER_GID: "0" },
		volumesJson: [
			{ host: "/opt/gitea/data", container: "/data" },
			{ host: "/etc/timezone", container: "/etc/timezone:ro" },
			{ host: "/etc/localtime", container: "/etc/localtime:ro" },
		],
	},
	{
		slug: "code-server",
		name: "Code Server",
		category: "devtools",
		icon: "💻",
		description: "在浏览器中运行 VS Code，随时随地远程开发",
		image: "linuxserver/code-server:latest",
		port: 8443,
		path: "/code-server/",
		envJson: { PUID: "0", PGID: "0", PASSWORD: "", SUDO_PASSWORD: "" },
		volumesJson: [{ host: "/opt/code-server/config", container: "/config" }],
	},
	{
		slug: "vaultwarden",
		name: "Vaultwarden 密码",
		category: "devtools",
		icon: "🔐",
		description: "轻量级 Bitwarden 兼容密码管理器",
		image: "vaultwarden/server:latest",
		port: 8081,
		path: "/vaultwarden/",
		envJson: {},
		volumesJson: [{ host: "/opt/vaultwarden/data", container: "/data" }],
	},
	{
		slug: "uptime-kuma",
		name: "Uptime Kuma",
		category: "network",
		icon: "🟢",
		description: "美观的网站/服务监控工具，支持多种通知方式",
		image: "louislam/uptime-kuma:latest",
		port: 3003,
		path: "/uptime-kuma/",
		envJson: {},
		volumesJson: [{ host: "/opt/uptime-kuma/data", container: "/app/data" }],
	},
	{
		slug: "portainer",
		name: "Portainer",
		category: "devtools",
		icon: "🐳",
		description: "Docker 容器可视化管理面板",
		image: "portainer/portainer-ce:latest",
		port: 9443,
		path: "/portainer/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/portainer/data", container: "/data" },
			{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" },
		],
	},
	{
		slug: "halo",
		name: "Halo 博客",
		category: "other",
		icon: "✍️",
		description: "强大的 Java 开源博客/CMS 系统",
		image: "halohub/halo:latest",
		port: 8090,
		path: "/halo/",
		envJson: { HALO_SECURITY_INITIALIZER_SUPERADMINUSERNAME: "admin", HALO_SECURITY_INITIALIZER_SUPERADMINPASSWORD: "admin123" },
		volumesJson: [{ host: "/opt/halo/data", container: "/root/.halo2" }],
	},
	{
		slug: "memos",
		name: "Memos 笔记",
		category: "other",
		icon: "📝",
		description: "轻量级自托管备忘录/笔记服务",
		image: "neosmemo/memos:latest",
		port: 5230,
		path: "/memos/",
		envJson: {},
		volumesJson: [{ host: "/opt/memos/data", container: "/var/opt/memos" }],
	},
	{
		slug: "stirling-pdf",
		name: "Stirling PDF",
		category: "devtools",
		icon: "📄",
		description: "强大的自托管 PDF 工具箱，支持合并/分割/转换/压缩等",
		image: "frooodle/s-pdf:latest",
		port: 8082,
		path: "/stirling-pdf/",
		envJson: { DOCKER_ENABLE_SECURITY: "false" },
		volumesJson: [{ host: "/opt/stirling-pdf/data", container: "/usr/share/tessdata" }],
	},
];

/* ── CRUD ──────────────────────────────────────────────────────── */

export async function listQuickServices() {
	return prisma.quickService.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
}

export async function getQuickService(slug: string) {
	return prisma.quickService.findUnique({ where: { slug } });
}

/* ── Install: create DB record + run docker ────────────────────── */

export async function installService(template: ServiceTemplate, userId?: string) {
	// Create volume dirs
	for (const vol of template.volumesJson) {
		try {
			execSync(`mkdir -p "${vol.host}"`, { timeout: 10000 });
		} catch {
			// best effort
		}
	}

	// Create DB record (installing state)
	const envStr = JSON.stringify(template.envJson);
	const volStr = JSON.stringify(template.volumesJson);
	const svc = await prisma.quickService.upsert({
		where: { slug: template.slug },
		update: { status: "installing", image: template.image, port: template.port, path: template.path, envJson: envStr, volumesJson: volStr, error: null },
		create: {
			slug: template.slug,
			name: template.name,
			category: template.category,
			icon: template.icon,
			description: template.description,
			image: template.image,
			port: template.port,
			path: template.path,
			envJson: envStr,
			volumesJson: volStr,
			status: "installing",
			createdBy: userId ?? null,
		},
	});

	// Run docker in background (don't await — let it pull and start)
	startDockerContainer(svc.id, template).catch(async (err) => {
		const msg = err instanceof Error ? err.message : String(err);
		await prisma.quickService.update({ where: { id: svc.id }, data: { status: "error", error: msg } });
	});

	return svc;
}

async function startDockerContainer(serviceId: string, tmpl: ServiceTemplate) {
	const containerName = `qs-${tmpl.slug}`;

	// Stop & remove old container if exists
	try {
		execSync(`docker rm -f ${containerName} 2>/dev/null`, { timeout: 15000 });
	} catch {
		// doesn't exist, fine
	}

	// Build docker run command
	const volArgs = tmpl.volumesJson.map((v) => `-v "${v.host}:${v.container}"`).join(" ");
	const envArgs = Object.entries(tmpl.envJson)
		.filter(([, v]) => v !== "")
		.map(([k, v]) => `-e ${k}=${v}`)
		.join(" ");

	const cmd = `docker run -d --name ${containerName} --restart unless-stopped -p ${tmpl.port}:${tmpl.port} ${volArgs} ${envArgs} ${tmpl.image}`;

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

	const containerName = `qs-${svc.slug}`;
	try {
		execSync(`docker rm -f ${containerName} 2>/dev/null`, { timeout: 15000 });
	} catch {
		// container may not exist
	}

	await prisma.quickService.delete({ where: { slug } });
}

/* ── Start / Stop ──────────────────────────────────────────────── */

export async function startService(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = `qs-${svc.slug}`;
	try {
		execSync(`docker start ${containerName}`, { timeout: 30000 });
		await prisma.quickService.update({ where: { slug }, data: { status: "running" } });
	} catch (err) {
		// Container may have been removed; try to re-create from DB info
		const tmpl: ServiceTemplate = {
			slug: svc.slug,
			name: svc.name,
			category: svc.category,
			icon: svc.icon,
			description: svc.description,
			image: svc.image,
			port: svc.port,
			path: svc.path,
			envJson: JSON.parse(svc.envJson),
			volumesJson: JSON.parse(svc.volumesJson),
		};
		await startDockerContainer(svc.id, tmpl);
	}
}

export async function stopService(slug: string) {
	const svc = await prisma.quickService.findUnique({ where: { slug } });
	if (!svc) throw new Error("服务不存在");

	const containerName = `qs-${svc.slug}`;
	try {
		execSync(`docker stop ${containerName}`, { timeout: 30000 });
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

	const containerName = `qs-${svc.slug}`;
	try {
		const state = execSync(`docker inspect --format='{{.State.Status}}' ${containerName} 2>/dev/null`, { timeout: 10000 }).toString().trim();
		const status = state === "running" ? "running" : state === "paused" ? "stopped" : "stopped";
		await prisma.quickService.update({ where: { slug }, data: { status, error: null } });
		return status;
	} catch {
		await prisma.quickService.update({ where: { slug }, data: { status: "stopped" } });
		return "stopped";
	}
}
