import { prisma } from "@/lib/db";
import { execRemoteCommand, buildSshParamsFromServer, writeRemoteFile, type SshConnectionParams } from "@/lib/ssh/client";
import { logError } from "@/lib/logging";

/* ── Types ────────────────────────────────────────────────── */

export type SyncJobInput = {
	name: string;
	sourceServerId: string;
	sourcePath: string;
	targetServerId: string;
	targetPath: string;
	syncType?: "MIRROR" | "BACKUP" | "INCREMENTAL";
	schedule?: string;
	deleteOrphans?: boolean;
	compress?: boolean;
	createdBy?: string;
};

type SyncTargetCommandInput = {
	sourcePath: string;
	targetPath: string;
	targetUser: string;
	targetHost: string;
	targetPort: number;
	keyPath?: string;
	password?: string;
};

const SSH_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RSYNC_HOST_PATTERN = /^[A-Za-z0-9.:[\]@_-]+$/;

type RsyncCommandInput = SyncTargetCommandInput & {
	flags: string[];
};

type TarSyncCommandInput = SyncTargetCommandInput & {
	deleteOrphans: boolean;
};

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellDoubleQuote(value: string): string {
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function safeFileStem(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function getSyncTempKeyPath(jobId: string, purpose: "rsync" | "tar"): string {
	return `/tmp/whrkhldsb-sync-${purpose}-${safeFileStem(jobId)}`;
}

function assertSafeSshUsername(username: string): void {
	if (!SSH_USERNAME_PATTERN.test(username) || username.startsWith("-")) {
		throw new Error("Unsafe SSH username");
	}
}

function assertSafeHost(host: string): void {
	if (!HOSTNAME_PATTERN.test(host) || host.startsWith("-")) {
		throw new Error("Unsafe SSH host");
	}
}

function formatRsyncHost(host: string): string {
	assertSafeHost(host);
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function formatSshHost(host: string): string {
	assertSafeHost(host);
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function buildRsyncTargetAddress(targetUser: string, targetHost: string): string {
	assertSafeSshUsername(targetUser);
	const address = `${targetUser}@${formatRsyncHost(targetHost)}`;
	if (!RSYNC_HOST_PATTERN.test(address)) {
		throw new Error("Unsafe rsync target address");
	}
	return address;
}

function buildSshTargetAddress(targetUser: string, targetHost: string): string {
	assertSafeSshUsername(targetUser);
	return `${targetUser}@${formatSshHost(targetHost)}`;
}

function assertSafeSshPort(targetPort: number): void {
	if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
		throw new Error("Unsafe SSH port");
	}
}

function buildSshOptions(targetPort: number): string {
	assertSafeSshPort(targetPort);
	return [
		"-o StrictHostKeyChecking=no",
		"-o UserKnownHostsFile=/dev/null",
		`-p ${targetPort}`,
	].join(" ");
}

function buildSshTransport(input: SyncTargetCommandInput): string {
	const sshCommand = ["ssh", buildSshOptions(input.targetPort)];
	if (input.keyPath) sshCommand.push("-i", shellQuote(input.keyPath));
	const base = sshCommand.join(" ");
	if (input.password) {
		return `sshpass -p ${shellQuote(input.password)} ${base}`;
	}
	return base;
}

function withKeyCleanup(command: string, keyPath?: string): string {
	if (!keyPath) return command;
	const quotedKeyPath = shellQuote(keyPath);
	return `trap 'rm -f -- ${quotedKeyPath}' EXIT\n${command}`;
}

export function buildRsyncCommand(input: RsyncCommandInput): string {
	const transport = buildSshTransport(input);
	const target = `${buildRsyncTargetAddress(input.targetUser, input.targetHost)}:${input.targetPath.replace(/\/$/, "")}/`;
	const command = `rsync ${input.flags.join(" ")} -e ${shellDoubleQuote(transport)} ${shellQuote(`${input.sourcePath.replace(/\/$/, "")}/`)} ${shellQuote(target)} 2>&1`;
	return withKeyCleanup(command, input.keyPath);
}

export function buildTarSyncCommand(input: TarSyncCommandInput): string {
	const transport = buildSshTransport(input);
	const targetAddress = buildSshTargetAddress(input.targetUser, input.targetHost);
	const prepareTarget = input.deleteOrphans
		? `mkdir -p -- ${shellQuote(input.targetPath)} && cd -- ${shellQuote(input.targetPath)} && find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xf - -C ${shellQuote(input.targetPath)}`
		: `mkdir -p -- ${shellQuote(input.targetPath)} && tar xf - -C ${shellQuote(input.targetPath)}`;
	const command = `tar cf - -C ${shellQuote(input.sourcePath)} . | ${transport} ${shellQuote(targetAddress)} ${shellQuote(prepareTarget)} 2>&1`;
	return withKeyCleanup(command, input.keyPath);
}

async function writeEphemeralPrivateKey(sourceSsh: SshConnectionParams, keyPath: string, privateKey: string): Promise<void> {
	await execRemoteCommand({
		...sourceSsh,
		command: `rm -f -- ${shellQuote(keyPath)} && umask 077 && : > ${shellQuote(keyPath)} && chmod 600 -- ${shellQuote(keyPath)}`,
		timeout: 15000,
	});
	await writeRemoteFile({ ...sourceSsh, remotePath: keyPath, content: privateKey });
	await execRemoteCommand({
		...sourceSsh,
		command: `chmod 600 -- ${shellQuote(keyPath)}`,
		timeout: 15000,
	});
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createSyncJob(input: SyncJobInput) {
	return prisma.syncJob.create({
		data: {
			name: input.name,
			sourceServerId: input.sourceServerId,
			sourcePath: input.sourcePath,
			targetServerId: input.targetServerId,
			targetPath: input.targetPath,
			syncType: input.syncType ?? "MIRROR",
			schedule: input.schedule ?? null,
			deleteOrphans: input.deleteOrphans ?? false,
			compress: input.compress ?? false,
			createdBy: input.createdBy ?? null,
		},
		include: {
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
		},
	});
}

export async function listSyncJobs() {
	return prisma.syncJob.findMany({
		include: {
			sourceServer: { select: { id: true, name: true, host: true } },
			targetServer: { select: { id: true, name: true, host: true } },
			creator: { select: { id: true, username: true, displayName: true } },
			_count: { select: { syncLogs: true } },
		},
		orderBy: { createdAt: "desc" },
	});
}

export async function getSyncJob(id: string) {
	return prisma.syncJob.findUnique({
		where: { id },
		include: {
			sourceServer: { include: { sshKey: true } },
			targetServer: { include: { sshKey: true } },
			syncLogs: { orderBy: { startedAt: "desc" }, take: 20 },
		},
	});
}

export async function deleteSyncJob(id: string) {
	return prisma.syncJob.delete({ where: { id } });
}

export async function updateSyncJob(id: string, data: Partial<Pick<SyncJobInput, "name" | "sourcePath" | "targetPath" | "syncType" | "schedule" | "deleteOrphans" | "compress">>) {
	return prisma.syncJob.update({ where: { id }, data });
}

/* ── Execute Sync ─────────────────────────────────────────── */

export async function executeSyncJob(jobId: string): Promise<void> {
	const job = await getSyncJob(jobId);
	if (!job) throw new Error("同步任务不存在");

	await prisma.syncJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

	const logEntry = await prisma.syncLog.create({
		data: { syncJobId: jobId, status: "RUNNING" },
	});

	const startTime = Date.now();

	try {
		// Build rsync command executed on the source server, pushing to target
		const sourceSsh = await buildSshParamsFromServer(job.sourceServer, job.sourceServer.sshKey);
		const targetSsh = await buildSshParamsFromServer(job.targetServer, job.targetServer.sshKey);

		// Determine rsync flags
		const flags: string[] = ["-avz", "--stats"];
		if (job.deleteOrphans) flags.push("--delete");
		if (job.compress) flags.push("--compress");

		// Build the remote-to-remote rsync command.
		// We run rsync from the source server, pushing to target via SSH.
		const targetHost = job.targetServer.host;
		const targetPort = job.targetServer.port || 22;
		const targetUser = job.targetServer.username || "root";
		const targetKeyPath = job.targetServer.sshKey?.privateKey ? getSyncTempKeyPath(jobId, "rsync") : undefined;

		if (!job.targetServer.sshKey?.privateKey && !job.targetServer.password) {
			throw new Error("目标服务器未配置 SSH 密钥或密码");
		}

		const rsyncCmd = buildRsyncCommand({
			flags,
			sourcePath: job.sourcePath,
			targetPath: job.targetPath,
			targetUser,
			targetHost,
			targetPort,
			keyPath: targetKeyPath,
			password: targetKeyPath ? undefined : (job.targetServer.password ?? undefined),
		});

		// Ensure target directory exists
		await execRemoteCommand({
			...targetSsh,
			command: `mkdir -p -- ${shellQuote(job.targetPath)}`,
			timeout: 15000,
		});

		// Ensure source directory exists
		await execRemoteCommand({
			...sourceSsh,
			command: `mkdir -p -- ${shellQuote(job.sourcePath)}`,
			timeout: 15000,
		});

		// Check if rsync is available on source
		const { stdout: whichRsync } = await execRemoteCommand({
			...sourceSsh,
			command: "which rsync 2>/dev/null || echo MISSING",
			timeout: 8000,
		});

		let output: string;

		if (whichRsync.trim() === "MISSING") {
			// Fallback: use tar + ssh for incremental sync
			const targetSshKey = job.targetServer.sshKey?.privateKey ? { privateKey: job.targetServer.sshKey.privateKey } : null;
			output = await executeTarSync(sourceSsh, jobId, job.sourcePath, targetSsh, targetHost, targetPort, targetUser, targetSshKey, job.targetServer.password ?? null, job.targetPath, job.deleteOrphans);
		} else {
			if (job.targetServer.sshKey?.privateKey && targetKeyPath) {
				await writeEphemeralPrivateKey(sourceSsh, targetKeyPath, job.targetServer.sshKey.privateKey);
			}
			const result = await execRemoteCommand({
				...sourceSsh,
				command: rsyncCmd,
				timeout: 600_000, // 10 min max
			});
			output = result.stdout;
		}

		// Parse rsync output for stats
		const stats = parseRsyncOutput(output);
		const duration = Date.now() - startTime;

		await prisma.syncLog.update({
			where: { id: logEntry.id },
			data: {
				status: "COMPLETED",
				filesScanned: stats.totalFiles,
				filesTransferred: stats.transferredFiles,
				bytesTransferred: String(stats.totalSize),
				durationMs: duration,
				completedAt: new Date(),
			},
		});

		await prisma.syncJob.update({
			where: { id: jobId },
			data: {
				status: "IDLE",
				lastSyncAt: new Date(),
				lastSyncResult: `成功: ${stats.transferredFiles} 文件, ${formatBytes(stats.totalSize)}, ${Math.round(duration / 1000)}s`,
			},
		});

	} catch (error) {
		const duration = Date.now() - startTime;
		const errMsg = error instanceof Error ? error.message : String(error);

		await prisma.syncLog.update({
			where: { id: logEntry.id },
			data: {
				status: "FAILED",
				errorMessage: errMsg.slice(0, 2000),
				durationMs: duration,
				completedAt: new Date(),
			},
		});

		await prisma.syncJob.update({
			where: { id: jobId },
			data: { status: "ERROR", lastSyncResult: `失败: ${errMsg.slice(0, 200)}` },
		});

		logError(`[SyncService] Job ${jobId} failed:`, error);
	}
}

/** Fallback tar-based sync when rsync is not available */
async function executeTarSync(
	sourceSsh: SshConnectionParams,
	jobId: string,
	sourcePath: string,
	_targetSsh: SshConnectionParams,
	targetHost: string,
	targetPort: number,
	targetUser: string,
	targetKey: { privateKey: string } | null,
	targetPassword: string | null,
	targetPath: string,
	_deleteOrphans: boolean,
): Promise<string> {
	// Use tar over SSH pipe — portable fallback when rsync is unavailable.
	const keyPath = targetKey ? getSyncTempKeyPath(jobId, "tar") : undefined;
	if (!targetKey && !targetPassword) {
		throw new Error("No SSH credentials for target");
	}

	const cmd = buildTarSyncCommand({
		sourcePath,
		targetPath,
		targetUser,
		targetHost,
		targetPort,
		keyPath,
		password: keyPath ? undefined : (targetPassword ?? undefined),
		deleteOrphans: _deleteOrphans,
	});
	if (targetKey && keyPath) {
		await writeEphemeralPrivateKey(sourceSsh, keyPath, targetKey.privateKey);
	}
	const result = await execRemoteCommand({ ...sourceSsh, command: cmd, timeout: 600_000 });
	return result.stdout;
}

/* ── Parse rsync output ───────────────────────────────────── */

function parseRsyncOutput(output: string) {
	let totalFiles = 0;
	let transferredFiles = 0;
	let totalSize = 0;

	const totalFileMatch = output.match(/Number of files:\s*(\d+)/);
	if (totalFileMatch) totalFiles = parseInt(totalFileMatch[1], 10);

	const transferredMatch = output.match(/Number of regular files transferred:\s*(\d+)/);
	if (transferredMatch) transferredFiles = parseInt(transferredMatch[1], 10);

	const totalSizeMatch = output.match(/Total file size:\s*([\d,]+)/);
	if (totalSizeMatch) totalSize = parseInt(totalSizeMatch[1].replace(/,/g, ""), 10);

	// Fallback: count lines that look like file transfers
	if (transferredFiles === 0) {
		const lines = output.split("\n").filter((l) => l && !l.startsWith("sent ") && !l.startsWith("total ") && !l.startsWith("Number") && !l.startsWith("Total") && !l.startsWith("speedup"));
		transferredFiles = lines.length;
	}

	return { totalFiles, transferredFiles, totalSize };
}

function formatBytes(n: number): string {
	if (n === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
