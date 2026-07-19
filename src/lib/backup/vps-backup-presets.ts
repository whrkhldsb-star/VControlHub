/**
 * TR-043: VPS remote backup presets.
 *
 * Each preset defines how to create a backup archive on a remote VPS.
 * The generated command writes a .tar.gz to a temporary path (using
 * mktemp -d) that is later SFTP-downloaded by the job worker.
 */

/** Preset identifier — also stored as VpsBackupRecord.backupType */
export type VpsBackupPresetType =
	| "nginx-config"
	| "mysql"
	| "postgres"
	| "docker-volumes"
	| "website-files"
	| "custom";

/** All valid preset types for validation */
export const VALID_PRESET_TYPES: readonly VpsBackupPresetType[] = [
	"nginx-config",
	"mysql",
	"postgres",
	"docker-volumes",
	"website-files",
	"custom",
] as const;

export function isVpsBackupPresetType(value: string): value is VpsBackupPresetType {
	return (VALID_PRESET_TYPES as readonly string[]).includes(value);
}

export interface BackupPreset {
	/** Human-readable label (i18n key prefix: `vpsBackup.preset.<type>`) */
	type: VpsBackupPresetType;
	/** Whether this preset requires custom paths */
	requiresPaths: boolean;
	/**
	 * Build the remote shell command that creates a backup archive.
	 *
	 * @param remoteFilePath  Absolute path where the .tar.gz should be written
	 * @param customPaths     User-specified paths (for "custom" type)
	 * @returns               Shell command string
	 */
	buildCommand: (remoteFilePath: string, customPaths?: string[]) => string;
	/** Description of what this preset backs up */
	description: string;
}

/* ── Preset definitions ──────────────────────────────────── */

const NGINX_CONFIG_PRESET: BackupPreset = {
	type: "nginx-config",
	requiresPaths: false,
	description: "Backs up /etc/nginx/ configuration directory",
	// Fail if /etc/nginx is missing or tar produces an empty archive.
	// Previous `|| true` marked empty tar.gz as COMPLETED (false success).
	buildCommand: (remoteFilePath) =>
		`set -euo pipefail; test -d /etc/nginx; tar czf '${remoteFilePath}' -C / etc/nginx; test -s '${remoteFilePath}'`,
};

const MYSQL_PRESET: BackupPreset = {
	type: "mysql",
	requiresPaths: false,
	description: "Dumps all MySQL databases via mysqldump",
	buildCommand: (remoteFilePath) =>
		`mysqldump --all-databases --single-transaction --routines --triggers 2>/dev/null | gzip > '${remoteFilePath}'`,
};

const POSTGRES_PRESET: BackupPreset = {
	type: "postgres",
	requiresPaths: false,
	description: "Dumps all PostgreSQL databases via pg_dumpall",
	buildCommand: (remoteFilePath) =>
		`pg_dumpall 2>/dev/null | gzip > '${remoteFilePath}'`,
};

const DOCKER_VOLUMES_PRESET: BackupPreset = {
	type: "docker-volumes",
	requiresPaths: false,
	description: "Backs up all Docker named volumes using a temporary Alpine container",
	buildCommand: (remoteFilePath) =>
		`docker run --rm -v /var/lib/docker/volumes:/data:ro -v '$(dirname '${remoteFilePath}')':/backup alpine tar czf /backup/'$(basename '${remoteFilePath}')' -C /data . 2>/dev/null`,
};

const WEBSITE_FILES_PRESET: BackupPreset = {
	type: "website-files",
	requiresPaths: false,
	description: "Backs up /var/www/ directory (common web root)",
	// Same false-success guard as nginx-config: do not swallow missing roots.
	buildCommand: (remoteFilePath) =>
		`set -euo pipefail; test -d /var/www; tar czf '${remoteFilePath}' -C / var/www; test -s '${remoteFilePath}'`,
};

const CUSTOM_PRESET: BackupPreset = {
	type: "custom",
	requiresPaths: true,
	description: "Backs up user-specified directories/files",
	buildCommand: (remoteFilePath, customPaths) => {
		if (!customPaths || customPaths.length === 0) {
			throw new Error("Custom backup requires at least one path");
		}
		// Sanitize each path: strip quotes, reject shell metacharacters
		const sanitized = customPaths
			.map((p) => p.trim().replace(/['"]/g, ""))
			.filter((p) => p && !p.includes("..") && !/[;|&`$(){}]/.test(p));

		if (sanitized.length === 0) {
			throw new Error("Custom backup: all paths were invalid after sanitization");
		}

		// tar with explicit path list — each path is relative to /
		const pathArgs = sanitized.map((p) => `'${p.replace(/^\/+/, "")}'`).join(" ");
		return `set -euo pipefail; tar czf '${remoteFilePath}' -C / ${pathArgs}; test -s '${remoteFilePath}'`;
	},
};

/* ── Registry ────────────────────────────────────────────── */

export const BACKUP_PRESETS: Record<VpsBackupPresetType, BackupPreset> = {
	"nginx-config": NGINX_CONFIG_PRESET,
	mysql: MYSQL_PRESET,
	postgres: POSTGRES_PRESET,
	"docker-volumes": DOCKER_VOLUMES_PRESET,
	"website-files": WEBSITE_FILES_PRESET,
	custom: CUSTOM_PRESET,
};

/**
 * Get a preset by type string.
 * Returns undefined for invalid types.
 */
export function getPreset(type: string): BackupPreset | undefined {
	if (!isVpsBackupPresetType(type)) return undefined;
	return BACKUP_PRESETS[type];
}

/**
 * Build the remote backup command for a given preset type.
 *
 * @param type         Preset type
 * @param remoteFilePath  Absolute path on remote VPS for the archive
 * @param customPaths  User paths (only for "custom" type)
 * @returns            Shell command string
 * @throws             If preset is invalid or custom paths are empty
 */
export function buildRemoteBackupCommand(
	type: string,
	remoteFilePath: string,
	customPaths?: string[],
): string {
	const preset = getPreset(type);
	if (!preset) {
		throw new Error(`Unknown backup preset type: ${type}`);
	}
	return preset.buildCommand(remoteFilePath, customPaths);
}

/**
 * Generate a unique remote temp file path for the backup archive.
 * Format: /tmp/vch-backup-{timestamp}-{random}.tar.gz
 */
export function generateRemoteBackupPath(): string {
	const ts = Date.now();
	const rand = Math.random().toString(36).slice(2, 10);
	return `/tmp/vch-backup-${ts}-${rand}.tar.gz`;
}

/**
 * Build the cleanup command to remove the remote temp file.
 */
export function buildRemoteCleanupCommand(remoteFilePath: string): string {
	// Sanitize: only allow /tmp/ prefix + alphanumeric/dash/dot/slash
	const sanitized = remoteFilePath.replace(/[^a-zA-Z0-9/._-]/g, "");
	return `rm -f '${sanitized}' 2>/dev/null; true`;
}
