/**
 * Sync service — credential decryption (R28 god-file split).
 *
 * Decrypts the target server's password / private key on demand.
 * Pure, no prisma, no SSH. Used by `./service-runtime` to build
 * the SSH transport before executing a sync job.
 */
import { decryptServerPassword, decryptStoredSshKey, type StoredSshKey } from "@/lib/ssh/ssh-key-crypto";

type SyncTargetCredentialsInput = {
	password?: string | null;
	sshKey?: StoredSshKey | null;
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
	return {
		password: input.password ? decryptPassword(input.password) : undefined,
		privateKey: input.sshKey?.privateKey ? decryptTargetKey(input.sshKey, decryptors.decryptPrivateKey) : undefined,
	};
}

/**
 * The key is written to the source VPS for its OpenSSH client, which runs
 * without a prompt: a legacy passphrase-protected key must be unlocked here
 * (decryptStoredSshKey), not handed over encrypted with its passphrase dropped.
 */
function decryptTargetKey(sshKey: StoredSshKey, decryptPrivateKey?: (value: string) => string): string | undefined {
	if (decryptPrivateKey) return decryptPrivateKey(sshKey.privateKey!);
	const decrypted = decryptStoredSshKey(sshKey);
	if (decrypted?.passphrase) {
		throw new Error("The target server's SSH key is passphrase-protected in a format that cannot be unlocked for rsync; import it again without a passphrase");
	}
	return decrypted?.privateKey;
}
