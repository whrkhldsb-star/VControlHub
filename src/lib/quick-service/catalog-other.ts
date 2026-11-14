import type { ServiceTemplate } from "./types";

export const OTHER_SERVICE_TEMPLATES: ServiceTemplate[] = [
	/* ── 🗂️ 其他服务 ─────────────────────────────────────────────── */
	{
		slug: "dufs",
		name: "Dufs File Sharing",
		category: "other",
		icon: "📤",
		description: "Minimal WebDAV/HTTP file sharing server, written in Rust",
		image: "sigoden/dufs:latest",
		defaultPort: 5001,
		// The image listens on 5000; 5001 is only the host port.
		internalPort: 5000,
		path: "/",
		envJson: {},
		volumesJson: [{ host: "/opt/dufs/data", container: "/data" }],
	},
	{
		slug: "pairdrop",
		name: "PairDrop File Transfer",
		category: "other",
		icon: "📲",
		description: "Cross-device file transfer, a web open-source alternative to AirDrop",
		image: "lscr.io/linuxserver/pairdrop:latest",
		defaultPort: 3007,
		// The image listens on 3000; 3007 is only the host port.
		internalPort: 3000,
		path: "/",
		envJson: { PUID: "0", PGID: "0" },
		volumesJson: [],
	},
	{
		slug: "tianji",
		name: "Tianji",
		category: "other",
		icon: "🔭",
		description: "All-in-one ops monitoring: website monitoring + server status + alert notifications",
		// Published as moonrailgun/tianji (the project's own compose file); "moonrailway" does not exist.
		image: "moonrailgun/tianji:latest",
		defaultPort: 3015,
		// The image listens on 12345; 3015 is only the host port.
		internalPort: 12345,
		path: "/",
		envJson: {},
		volumesJson: [{ host: "/opt/tianji/data", container: "/data" }],
	},
	{
		slug: "lobe-chat",
		name: "LobeChat AI",
		category: "other",
		icon: "🤖",
		description: "Beautiful open-source ChatGPT/LLM chat interface, supports multiple models",
		image: "lobehub/lobe-chat:latest",
		defaultPort: 3016,
		// The image listens on 3210; 3016 is only the host port.
		internalPort: 3210,
		path: "/",
		envJson: {},
		volumesJson: [],
	},
	{
		slug: "frps",
		name: "FRP Tunnel",
		category: "other",
		icon: "🔗",
		description: "High-performance intranet penetration server, exposes intranet services to the public network",
		image: "snowdreamtech/frps:latest",
		defaultPort: 7500,
		path: "/",
		envJson: {},
		volumesJson: [{ host: "/opt/frps/config", container: "/etc/frp" }],
	},
	{
		slug: "maxtext",
		name: "MaxKB Knowledge Base",
		category: "other",
		icon: "🧠",
		description: "LLM-based knowledge base Q&A system, an open-source RAG solution",
		image: "1panel/maxkb:latest",
		defaultPort: 3017,
		// The image listens on 8080; 3017 is only the host port.
		internalPort: 8080,
		path: "/",
		envJson: {},
		volumesJson: [{ host: "/opt/maxkb/data", container: "/var/lib/maxkb" }],
	},
];
