import type { DockerContainerStats } from "@/lib/docker/stats";

export interface Container {
	Id: string;
	Names: string[];
	Image: string;
	State: string;
	Status: string;
	Ports: { IP: string; PrivatePort: number; PublicPort: number; Type: string }[];
	Labels?: Record<string, string>;
}

/**
 * Stats shape served by the docker stats API (`parseDockerStats` in
 * lib/docker/stats) — one source of truth for both the API and the UI.
 */
export type ContainerStats = DockerContainerStats;

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

/** Re-export shared formatter (audit: drop local duplicate). */
export { formatBytes } from "@/lib/format/bytes";

export function getContainerName(
	t: (key: string, vars?: Record<string, string | number>) => string,
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

export function stateLabel(t: (key: string, vars?: Record<string, string | number>) => string, state: string): string {
	if (isKnownDockerState(state)) return t(`dockerPage.state.${state}`);
	return state;
}

