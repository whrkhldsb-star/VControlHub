/**
 * Sync service — credential decryption (R28 god-file split).
 *
 * Decrypts the target server's password / private key on demand.
 * Pure, no prisma, no SSH. Used by `./service-runtime` to build
 * the SSH transport before executing a sync job.
 */
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

type SyncTargetCredentialsInput = {
	password?: string | null;
	sshKey?: { privateKey?: string | null } | null;
};

type CredentialDecryptors = {
	decryptPassword?: (value: string) => string;
	decryptPrivateKey?: (value: string) => string;
};

export function decryptSyncTargetCredentials(
	input: SyncTargetCredentialsInput,
	decryptors: CredentialDecryptors = {},
): { password?: string; privateKey?: string } {
	const decryptPassword = decryptors.decryptPassword ?? decryptServerPassword;
	const decryptPrivateKey = decryptors.decryptPrivateKey ?? decryptSshPrivateKey;
	return {
		password: input.password ? decryptPassword(input.password) : undefined,
		privateKey: input.sshKey?.privateKey ? decryptPrivateKey(input.sshKey.privateKey) : undefined,
	};
}
