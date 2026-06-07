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
	/** Explicitly allow mounting /var/run/docker.sock for trusted built-in templates. */
	allowDockerSocket?: boolean;
	/** Optional initial password to apply after container creation for apps that generate one-time defaults. */
	initialPassword?: string;
}
