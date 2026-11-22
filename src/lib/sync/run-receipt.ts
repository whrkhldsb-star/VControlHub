import { decrypt, encrypt } from "@/lib/crypto/service";
import type { buildSshParamsFromServer } from "@/lib/ssh/client";
import { z } from "zod";

type CleanupEndpoint = Parameters<typeof buildSshParamsFromServer>[0] & {
	sshKey: Parameters<typeof buildSshParamsFromServer>[1];
};

export type SyncRunScope = {
	sourceServerId: string; targetServerId: string; sourcePath: string; targetPath: string;
};

export type SyncRunReceipt = {
	scope: SyncRunScope;
	cleanup?: CleanupEndpoint[];
	error?: string;
	result?: string;
};

const PREFIX = "sync-run-v1:";
const envelope = z.object({
	scope: z.object({ sourceServerId: z.string(), sourcePath: z.string(), targetServerId: z.string(), targetPath: z.string() }),
	error: z.string().optional(), result: z.string().optional(), cleanup: z.string().optional(),
});

export function encodeSyncRun(receipt: SyncRunReceipt) {
	const { cleanup, ...history } = receipt;
	return PREFIX + JSON.stringify({ ...history, ...(cleanup && { cleanup: encrypt(JSON.stringify(cleanup)) }) });
}

export function readSyncRun(value?: string | null, forCleanup = false): SyncRunReceipt | null {
	if (!value?.startsWith(PREFIX)) return null;
	let parsed: unknown;
	try { parsed = JSON.parse(value.slice(PREFIX.length)); } catch { return null; }
	const receipt = envelope.safeParse(parsed);
	if (!receipt.success) return null;
	const { cleanup, ...history } = receipt.data;
	return forCleanup && cleanup ? { ...history, cleanup: JSON.parse(decrypt(cleanup)) as CleanupEndpoint[] } : history;
}

/** Freeze only the connection fields used by the cleanup transport. */
export function cleanupEndpoint(server: CleanupEndpoint): CleanupEndpoint {
	const { id, teamId, managementMode, operatingSystem, agentTokenHash, host, port, username, connectionType, sshKeyId, hostKeySha256, password, sshKey } = server;
	return { id, teamId, managementMode, operatingSystem, agentTokenHash, host, port, username, connectionType, sshKeyId, hostKeySha256, password,
		sshKey: sshKey && { teamId: sshKey.teamId, privateKey: sshKey.privateKey, passphrase: sshKey.passphrase } };
}
