import { prisma } from "@/lib/db";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import net from "net";

const run = promisify(exec);

/* ── Port allocation & detection ──────────────────────────────── */

const PORT_RANGE_MIN = 10000;
const PORT_RANGE_MAX = 65535;
const PORT_MAX_ATTEMPTS = 50;

/** Real-time check: is a TCP port available on this host? */
export function isPortAvailable(port: number): boolean {
	/* Method 1: ss (fast, kernel-level) */
	try {
		const out = execSync(`ss -tlnpH 2>/dev/null | grep -E ':${port}\\b'`, {
			timeout: 5000,
			encoding: "utf8",
		});
		if (out.trim().length > 0) return false; // something is listening
	} catch {
		// ss returned nothing → port likely free; fall through to bind test
	}

	/* Method 2: actual bind test (authoritative) */
	return new Promise<boolean>((resolve) => {
		const server = net.createServer();
		server.once("error", () => { resolve(false); server.close(); });
		server.once("listening", () => { resolve(true); server.close(); });
		server.listen(port, "0.0.0.0");
	}).valueOf() as boolean; // sync-ish: we rely on ss first, bind as backup
}

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

/* ── Service catalog (built-in templates) ─────────────────────── */

export interface ServiceTemplate {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	/** Recommended/default port (used as suggestion; actual port assigned at install time) */
	defaultPort: number;
	/** Internal port the container listens on (may differ from host port) */
	internalPort?: number;
	path: string;
	envJson: Record<string, string>;
	volumesJson: Array<{ host: string; container: string }>;
	/** Optional command override for images that need a custom entrypoint (e.g. MinIO) */
	command?: string;
	/** Additional port mappings beyond the primary port (e.g. MinIO API:9000) */
	extraPorts?: Array<{ host: number; container: number }>;
}

export const SERVICE_CATALOG: ServiceTemplate[] = [
	/* ── ☁️ 存储网盘 ─────────────────────────────────────────────── */
	{
		slug: "alist",
		name: "AList 云盘",
		category: "storage",
		icon: "☁️",
		description: "支持多种存储的文件列表程序，可挂载阿里云盘、OneDrive、S3等",
		image: "xhofe/alist:latest",
		defaultPort: 5244,
		path: "/files-proxy/",
		envJson: { PUID: "0", PGID: "0", UMASK: "022" },
		volumesJson: [{ host: "/opt/alist/data", container: "/opt/alist/data" }],
	},
	{
		slug: "nextcloud",
		name: "Nextcloud 网盘",
		category: "storage",
		icon: "📁",
		description: "自托管的私有云存储和协作平台，支持文件同步/日历/联系人",
		image: "nextcloud:latest",
		defaultPort: 8080,
		internalPort: 80,
		path: "/nextcloud/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/nextcloud/html", container: "/var/www/html" },
			{ host: "/opt/nextcloud/data", container: "/var/www/html/data" },
		],
	},
	{
		slug: "filebrowser",
		name: "File Browser",
		category: "storage",
		icon: "📂",
		description: "极简的 Web 文件管理器，支持上传/下载/编辑/分享",
		image: "filebrowser/filebrowser:latest",
		defaultPort: 8110,
		path: "/fb/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/filebrowser/db", container: "/database" },
			{ host: "/opt/filebrowser/config", container: "/config" },
			{ host: "/srv", container: "/srv" },
		],
	},
	{
		slug: "minio",
		name: "MinIO 对象存储",
		category: "storage",
		icon: "🗄️",
		description: "高性能 S3 兼容对象存储，适合备份/CDN/数据湖",
		image: "minio/minio:latest",
		defaultPort: 9001,
		internalPort: 9000,
		path: "/minio/",
		envJson: { MINIO_ROOT_USER: "minioadmin", MINIO_ROOT_PASSWORD: "minioadmin" },
		volumesJson: [{ host: "/opt/minio/data", container: "/data" }],
		command: "server /data --console-address ':9001'",
	},
	{
		slug: "davos",
		name: "Davos 下载管理",
		category: "storage",
		icon: "📥",
		description: "WebDAV/FTP/SFTP 自动同步下载管理器",
		image: "linuxserver/davos:latest",
		defaultPort: 8111,
		path: "/davos/",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [
			{ host: "/opt/davos/config", container: "/config" },
			{ host: "/opt/davos/downloads", container: "/downloads" },
		],
	},

	/* ── 🎬 媒体影视 ─────────────────────────────────────────────── */
	{
		slug: "emby",
		name: "Emby 影视",
		category: "media",
		icon: "🎬",
		description: "强大的媒体服务器，管理和串流你的电影、电视剧和音乐",
		image: "emby/embyserver:latest",
		defaultPort: 8096,
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
		defaultPort: 8097,
		path: "/jellyfin/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/jellyfin/config", container: "/config" },
			{ host: "/opt/jellyfin/cache", container: "/cache" },
			{ host: "/opt/jellyfin/media", container: "/media" },
		],
	},
	{
		slug: "navidrome",
		name: "Navidrome 音乐",
		category: "media",
		icon: "🎵",
		description: "轻量级自托管音乐流媒体服务器，Subsonic 兼容",
		image: "deluan/navidrome:latest",
		defaultPort: 4533,
		path: "/navidrome/",
		envJson: { ND_SCANSCHEDULE: "1h", ND_LOGLEVEL: "info", ND_SESSIONTIMEOUT: "24h" },
		volumesJson: [
			{ host: "/opt/navidrome/data", container: "/data" },
			{ host: "/opt/navidrome/music", container: "/music:ro" },
		],
	},
	{
		slug: "photoprism",
		name: "PhotoPrism 相册",
		category: "media",
		icon: "📸",
		description: "AI 驱动的自托管照片管理，自动分类和人脸识别",
		image: "photoprism/photoprism:latest",
		defaultPort: 2342,
		path: "/photoprism/",
		envJson: { PHOTOPRISM_ADMIN_PASSWORD: "pleasechange", PHOTOPRISM_AUTH_MODE: "password" },
		volumesJson: [
			{ host: "/opt/photoprism/originals", container: "/photoprism/originals" },
			{ host: "/opt/photoprism/storage", container: "/photoprism/storage" },
		],
	},
	{
		slug: "immich",
		name: "Immich 相册",
		category: "media",
		icon: "🖼️",
		description: "高性能自托管照片/视频备份，Google Photos 开源替代",
		image: "ghcr.io/immich-app/immich-server:release",
		defaultPort: 2283,
		path: "/immich/",
		envJson: { DB_HOSTNAME: "127.0.0.1" },
		volumesJson: [
			{ host: "/opt/immich/upload", container: "/usr/src/app/upload" },
		],
	},
	{
		slug: "metube",
		name: "MeTube 下载",
		category: "media",
		icon: "⬇️",
		description: "YouTube-dl 的 Web GUI，支持 YouTube/B站等视频下载",
		image: "ghcr.io/alexta69/metube:latest",
		defaultPort: 8088,
		path: "/metube/",
		envJson: {},
		volumesJson: [{ host: "/opt/metube/downloads", container: "/downloads" }],
	},
	{
		slug: "komga",
		name: "Komga 漫画",
		category: "media",
		icon: "📕",
		description: "漫画/电子书媒体服务器，支持 CBZ/CBR/EPUB/PDF",
		image: "gotson/komga:latest",
		defaultPort: 8083,
		path: "/komga/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/komga/config", container: "/config" },
			{ host: "/opt/komga/books", container: "/books" },
		],
	},

	/* ── 🔧 开发工具 ─────────────────────────────────────────────── */
	{
		slug: "gitea",
		name: "Gitea Git",
		category: "devtools",
		icon: "🔨",
		description: "轻量级自托管 Git 服务，类似 GitHub/GitLab",
		image: "gitea/gitea:latest",
		defaultPort: 3002,
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
		defaultPort: 8443,
		path: "/code-server/",
		envJson: { PUID: "0", PGID: "0", PASSWORD: "", SUDO_PASSWORD: "" },
		volumesJson: [{ host: "/opt/code-server/config", container: "/config" }],
	},
	{
		slug: "vaultwarden",
		name: "Vaultwarden 密码",
		category: "devtools",
		icon: "🔐",
		description: "轻量级 Bitwarden 兼容密码管理器，Rust 编写",
		image: "vaultwarden/server:latest",
		defaultPort: 8081,
		path: "/vaultwarden/",
		envJson: {},
		volumesJson: [{ host: "/opt/vaultwarden/data", container: "/data" }],
	},
	{
		slug: "portainer",
		name: "Portainer",
		category: "devtools",
		icon: "🐳",
		description: "Docker 容器可视化管理面板，支持 Swarm/K8s",
		image: "portainer/portainer-ce:latest",
		defaultPort: 9443,
		path: "/portainer/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/portainer/data", container: "/data" },
			{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" },
		],
		command: "--http-enabled",
	},
	{
		slug: "stirling-pdf",
		name: "Stirling PDF",
		category: "devtools",
		icon: "📄",
		description: "强大的自托管 PDF 工具箱，支持合并/分割/转换/压缩等",
		image: "frooodle/s-pdf:latest",
		defaultPort: 8082,
		path: "/stirling-pdf/",
		envJson: { DOCKER_ENABLE_SECURITY: "false" },
		volumesJson: [{ host: "/opt/stirling-pdf/data", container: "/usr/share/tessdata" }],
	},
	{
		slug: "it-tools",
		name: "IT-Tools",
		category: "devtools",
		icon: "🛠️",
		description: "开发者在线工具箱：加密/解码/转换/正则/UUID等数十种工具",
		image: "corentinth/it-tools:latest",
		defaultPort: 8112,
		path: "/it-tools/",
		envJson: {},
		volumesJson: [],
	},
	{
		slug: "n8n",
		name: "n8n 自动化",
		category: "devtools",
		icon: "🔄",
		description: "开源工作流自动化，连接 400+ 应用，Zapier 替代",
		image: "n8nio/n8n:latest",
		defaultPort: 5678,
		path: "/n8n/",
		envJson: { N8N_BASIC_AUTH_ACTIVE: "true", N8N_BASIC_AUTH_USER: "admin", N8N_BASIC_AUTH_PASSWORD: "admin" },
		volumesJson: [{ host: "/opt/n8n/data", container: "/home/node/.n8n" }],
	},
	{
		slug: "gladys",
		name: "Gladys 助手",
		category: "devtools",
		icon: "🏠",
		description: "开源智能家居平台，支持 MQTT/Zigbee/HomeKit",
		image: "gladysassistant/gladys:latest",
		defaultPort: 8113,
		path: "/gladys/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/gladys/data", container: "/var/lib/gladysassistant" },
			{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" },
		],
	},

	/* ── 📝 笔记文档 ─────────────────────────────────────────────── */
	{
		slug: "memos",
		name: "Memos 笔记",
		category: "notes",
		icon: "📝",
		description: "轻量级自托管备忘录/笔记服务，Flomo 替代",
		image: "neosmemo/memos:latest",
		defaultPort: 5230,
		path: "/memos/",
		envJson: {},
		volumesJson: [{ host: "/opt/memos/data", container: "/var/opt/memos" }],
	},
	{
		slug: "outline",
		name: "Outline 知识库",
		category: "notes",
		icon: "📖",
		description: "美观的团队知识库/Wiki，Notion 开源替代",
		image: "outlinewiki/outline:latest",
		defaultPort: 3010,
		path: "/outline/",
		envJson: { PGSSLMODE: "disable" },
		volumesJson: [{ host: "/opt/outline/data", container: "/var/lib/outline/data" }],
	},
	{
		slug: "hedgedoc",
		name: "HedgeDoc 协作",
		category: "notes",
		icon: "📑",
		description: "实时协作 Markdown 编辑器，多人同时编辑",
		image: "quay.io/hedgedoc/hedgedoc:latest",
		defaultPort: 3011,
		path: "/hedgedoc/",
		envJson: {},
		volumesJson: [{ host: "/opt/hedgedoc/uploads", container: "/hedgedoc/public/uploads" }],
	},
	{
		slug: "affine",
		name: "AFFiNE 工作区",
		category: "notes",
		icon: "🧩",
		description: "一体化工作区：文档/白板/数据库，Notion+Miro 替代",
		image: "ghcr.io/toeverything/affine-self-hosted:latest",
		defaultPort: 3012,
		path: "/affine/",
		envJson: {},
		volumesJson: [{ host: "/opt/affine/data", container: "/root/.affine" }],
	},
	{
		slug: "linkwarden",
		name: "Linkwarden 书签",
		category: "notes",
		icon: "🔖",
		description: "自托管书签管理器，自动抓取网页快照/截图",
		image: "ghcr.io/linkwarden/linkwarden:latest",
		defaultPort: 3013,
		path: "/linkwarden/",
		envJson: {},
		volumesJson: [{ host: "/opt/linkwarden/data", container: "/data/data" }],
	},
	{
		slug: "wallabag",
		name: "Wallabag 稍后读",
		category: "notes",
		icon: "📰",
		description: "自托管稍后读服务，保存网页文章离线阅读",
		image: "wallabag/wallabag:latest",
		defaultPort: 3014,
		path: "/wallabag/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/wallabag/images", container: "/var/www/wallabag/web/assets/images" },
			{ host: "/opt/wallabag/data", container: "/var/www/wallabag/data" },
		],
	},

	/* ── 🌐 网络监控 ─────────────────────────────────────────────── */
	{
		slug: "uptime-kuma",
		name: "Uptime Kuma",
		category: "network",
		icon: "🟢",
		description: "美观的网站/服务监控工具，支持 HTTP/TCP/DNS/Ping 等多种探针",
		image: "louislam/uptime-kuma:latest",
		defaultPort: 3003,
		path: "/uptime-kuma/",
		envJson: {},
		volumesJson: [{ host: "/opt/uptime-kuma/data", container: "/app/data" }],
	},
	{
		slug: "adguardhome",
		name: "AdGuard Home",
		category: "network",
		icon: "🛡️",
		description: "全网络广告/追踪器拦截 DNS 服务器，Pi-hole 替代",
		image: "adguard/adguardhome:latest",
		defaultPort: 3004,
		internalPort: 3000,
		path: "/adguard/",
		envJson: {},
		volumesJson: [
			{ host: "/opt/adguardhome/work", container: "/opt/adguardhome/work" },
			{ host: "/opt/adguardhome/conf", container: "/opt/adguardhome/conf" },
		],
	},
	{
		slug: "pihole",
		name: "Pi-hole",
		category: "network",
		icon: "🕳️",
		description: "DNS 级广告拦截器，保护全网络免受广告侵扰",
		image: "pihole/pihole:latest",
		defaultPort: 8085,
		internalPort: 80,
		path: "/admin/",
		envJson: { WEBPASSWORD: "changeme", DNS1: "8.8.8.8", DNS2: "8.8.4.4" },
		volumesJson: [
			{ host: "/opt/pihole/etc-pihole", container: "/etc/pihole" },
			{ host: "/opt/pihole/etc-dnsmasq", container: "/etc/dnsmasq.d" },
		],
	},
	{
		slug: "speedtest-tracker",
		name: "SpeedTest 测速",
		category: "network",
		icon: "⚡",
		description: "自动定时网速测试和记录，生成历史趋势图表",
		image: "ghcr.io/alexjustesen/speedtest-tracker:latest",
		defaultPort: 3005,
		path: "/speedtest/",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [{ host: "/opt/speedtest/config", container: "/config" }],
	},
	{
		slug: "beszel",
		name: "Beszel 监控",
		category: "network",
		icon: "📊",
		description: "轻量级服务器监控面板，CPU/内存/磁盘/网络实时图表",
		image: "henrygd/beszel:latest",
		defaultPort: 3006,
		path: "/beszel/",
		envJson: {},
		volumesJson: [{ host: "/opt/beszel/data", container: "/data" }],
	},
	{
		slug: "changedetection",
		name: "ChangeDetec 变更",
		category: "network",
		icon: "👁️",
		description: "网页变更监控，自动检测页面内容变化并通知",
		image: "dgtlmoon/changedetection.io:latest",
		defaultPort: 5000,
		path: "/changedetection/",
		envJson: {},
		volumesJson: [{ host: "/opt/changedetection/data", container: "/datastore" }],
	},

	/* ── ✍️ 博客建站 ─────────────────────────────────────────────── */
	{
		slug: "halo",
		name: "Halo 博客",
		category: "blog",
		icon: "✍️",
		description: "强大的 Java 开源博客/CMS 系统，主题/插件生态丰富",
		image: "halohub/halo:latest",
		defaultPort: 8090,
		path: "/halo/",
		envJson: { HALO_SECURITY_INITIALIZER_SUPERADMINUSERNAME: "admin", HALO_SECURITY_INITIALIZER_SUPERADMINPASSWORD: "admin123" },
		volumesJson: [{ host: "/opt/halo/data", container: "/root/.halo2" }],
	},
	{
		slug: "ghost",
		name: "Ghost 博客",
		category: "blog",
		icon: "👻",
		description: "专业级开源博客/Newsletter 平台，WordPress 替代",
		image: "ghost:latest",
		defaultPort: 2368,
		path: "/ghost/",
		envJson: { url: "http://localhost:2368" },
		volumesJson: [{ host: "/opt/ghost/content", container: "/var/lib/ghost/content" }],
	},
	{
		slug: "wordpress",
		name: "WordPress",
		category: "blog",
		icon: "🌐",
		description: "全球最流行的 CMS，插件/主题生态无可匹敌",
		image: "wordpress:latest",
		defaultPort: 8084,
		internalPort: 80,
		path: "/wordpress/",
		envJson: { WORDPRESS_DB_HOST: "127.0.0.1", WORDPRESS_DB_USER: "root", WORDPRESS_DB_PASSWORD: "", WORDPRESS_DB_NAME: "wordpress" },
		volumesJson: [{ host: "/opt/wordpress/data", container: "/var/www/html" }],
	},
	{
		slug: "typecho",
		name: "Typecho 博客",
		category: "blog",
		icon: "📝",
		description: "轻量级 PHP 博客系统，极简高效",
		image: "joyqi/typecho:latest",
		defaultPort: 8086,
		internalPort: 80,
		path: "/typecho/",
		envJson: {},
		volumesJson: [{ host: "/opt/typecho/data", container: "/app/usr" }],
	},

	/* ── 🗂️ 其他服务 ─────────────────────────────────────────────── */
	{
		slug: "itdog-tcping",
		name: "ITDog TCPing",
		category: "other",
		icon: "🏓",
		description: "多节点 TCPing 监测工具，检测全球网络连通性",
		image: "johnserfdev/itdog-tcping:latest",
		defaultPort: 8087,
		path: "/itdog/",
		envJson: {},
		volumesJson: [],
	},
	{
		slug: "qrcode",
		name: "QR Code 生成",
		category: "other",
		icon: "📱",
		description: "自托管二维码生成服务，无需第三方 API",
		image: "alexzorin/qrcode-server:latest",
		defaultPort: 8089,
		path: "/qrcode/",
		envJson: {},
		volumesJson: [],
	},
	{
		slug: "dufs",
		name: "Dufs 文件分享",
		category: "other",
		icon: "📤",
		description: "极简的 WebDAV/HTTP 文件分享服务器，Rust 编写",
		image: "sigoden/dufs:latest",
		defaultPort: 5001,
		path: "/dufs/",
		envJson: {},
		volumesJson: [{ host: "/opt/dufs/data", container: "/data" }],
	},
	{
		slug: "pairdrop",
		name: "PairDrop 传文件",
		category: "other",
		icon: "📲",
		description: "跨设备文件传输，AirDrop 的 Web 开源替代",
		image: "lscr.io/linuxserver/pairdrop:latest",
		defaultPort: 3007,
		path: "/pairdrop/",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [],
	},
	{
		slug: "tianji",
		name: "Tianji 天迹",
		category: "other",
		icon: "🔭",
		description: "一体化运维监控：网站监测+服务器状态+通知告警",
		image: "moonrailway/tianji:latest",
		defaultPort: 3015,
		path: "/tianji/",
		envJson: {},
		volumesJson: [{ host: "/opt/tianji/data", container: "/data" }],
	},
	{
		slug: "lobe-chat",
		name: "LobeChat AI",
		category: "other",
		icon: "🤖",
		description: "美观的开源 ChatGPT/LLM 聊天界面，支持多模型",
		image: "lobehub/lobe-chat:latest",
		defaultPort: 3016,
		path: "/lobe-chat/",
		envJson: {},
		volumesJson: [],
	},
	{
		slug: "frps",
		name: "FRP 内网穿透",
		category: "other",
		icon: "🔗",
		description: "高性能内网穿透服务器，将内网服务暴露到公网",
		image: "snowdreamtech/frps:latest",
		defaultPort: 7500,
		path: "/frps/",
		envJson: {},
		volumesJson: [{ host: "/opt/frps/config", container: "/etc/frp" }],
	},
	{
		slug: "maxtext",
		name: "MaxKB 知识库",
		category: "other",
		icon: "🧠",
		description: "基于 LLM 的知识库问答系统，RAG 开源方案",
		image: "1panel/maxkb:latest",
		defaultPort: 3017,
		path: "/maxkb/",
		envJson: {},
		volumesJson: [{ host: "/opt/maxkb/data", container: "/var/lib/maxkb" }],
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
			execSync(`mkdir -p "${vol.host}"`, { timeout: 10000 });
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
	const containerName = `qs-${tmpl.slug}`;

	// Stop & remove old container if exists
	try {
		execSync(`docker rm -f ${containerName} 2>/dev/null`, { timeout: 15000 });
	} catch {
		// doesn't exist, fine
	}

	// Build docker run command
	const internalPort = tmpl.internalPort ?? tmpl.defaultPort;
	const portMapping = `-p ${hostPort}:${internalPort}`;
	const extraPortMappings = (tmpl.extraPorts ?? [])
		.map((ep) => `-p ${ep.host}:${ep.container}`)
		.join(" ");
	const volArgs = tmpl.volumesJson.map((v) => `-v "${v.host}:${v.container}"`).join(" ");
	const envArgs = Object.entries(tmpl.envJson)
		.filter(([, v]) => v !== "")
		.map(([k, v]) => `-e ${k}=${v}`)
		.join(" ");
	const cmdSuffix = tmpl.command ? ` ${tmpl.command}` : "";

	const cmd = `docker run -d --name ${containerName} --restart unless-stopped ${portMapping} ${extraPortMappings} ${volArgs} ${envArgs} ${tmpl.image}${cmdSuffix}`;

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

/* ── Port check API helper ─────────────────────────────────────── */

/** Check if a specific port is available; returns { available, usedBy } */
export function checkPort(port: number): { available: boolean; usedBy: string | null } {
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
				try {
					const cmdLine = execSync(`cat /proc/${pidMatch[1]}/cmdline 2>/dev/null | tr '\\0' ' '`, {
						timeout: 3000,
						encoding: "utf8",
					});
					usedBy = cmdLine.trim().substring(0, 80) || `PID ${pidMatch[1]}`;
				} catch {
					usedBy = `PID ${pidMatch[1]}`;
				}
			}
			return { available: false, usedBy };
		}
		return { available: true, usedBy: null };
	} catch {
		return { available: true, usedBy: null };
	}
}
