export interface Container {
	Id: string;
	Names: string[];
	Image: string;
	State: string;
	Status: string;
	Ports: { IP: string; PrivatePort: number; PublicPort: number; Type: string }[];
	Labels?: Record<string, string>;
}

export type ComposeGroup = {
	project: string;
	containers: Container[];
};

export type ContainerStats = {
	id: string;
	name: string;
	cpuPercent: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
	memoryPercent: number;
	networkRxBytes: number;
	networkTxBytes: number;
	blockReadBytes: number;
	blockWriteBytes: number;
	pids: number;
};

export type DockerScope = {
	scope: "hub-host" | "remote-vps";
	socketPath: string;
	serverId?: string;
	serverName?: string;
	warning: string;
};

export type ServerOption = {
	id: string;
	name: string;
	host: string;
};

export function formatBytes(bytes: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return index === 0 ? `${Math.round(value)} ${units[index]}` : `${value.toFixed(1)} ${units[index]}`;
}

export function getContainerName(
	t: (key: string) => string,
	container: Pick<Container, "Id" | "Names">,
) {
	return (container.Names?.[0] || container.Id?.slice(0, 12) || t("dockerPage.state.unknown")).replace(
		/^\//,
		"",
	);
}

const KNOWN_DOCKER_STATES = [
	"running",
	"exited",
	"paused",
	"created",
	"restarting",
	"dead",
	"removing",
] as const;
export type KnownDockerState = (typeof KNOWN_DOCKER_STATES)[number];

export function isKnownDockerState(state: string): state is KnownDockerState {
	return (KNOWN_DOCKER_STATES as readonly string[]).includes(state);
}

export function stateLabel(t: (key: string) => string, state: string): string {
	if (isKnownDockerState(state)) return t(`dockerPage.state.${state}`);
	return state;
}

export const stateColors: Record<string, string> = {
	running: "bg-[var(--success-bg)] text-[var(--success)]",
	exited: "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]",
	paused: "bg-[var(--warning-bg)] text-[var(--warning)]",
	created: "bg-[var(--accent-bg)] text-[var(--accent)]",
	restarting: "bg-[var(--warning-bg)] text-[var(--warning)]",
	dead: "bg-[var(--danger-bg)] text-[var(--danger)]",
	removing: "bg-[var(--danger-bg)] text-[var(--danger)]",
};
