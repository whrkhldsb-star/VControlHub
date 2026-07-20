import { BusinessError, ConflictError, ValidationError } from "@/lib/errors";
import { execRemoteCommand, type SshConnectionParams } from "./client";
import { t } from "@/lib/i18n/translations";

export class SshHostKeyApprovalRequiredError extends BusinessError {
  readonly hostKeySha256: string;

  constructor(hostKeySha256: string) {
    super(
      `First connection requires confirming the SSH host fingerprint: ${hostKeySha256}. Please check "I have verified and trust this SSH host fingerprint" and resubmit.`,
      { hostKeySha256 },
    );
    this.name = "SshHostKeyApprovalRequiredError";
    this.hostKeySha256 = hostKeySha256;
  }
}

export class SshHostKeyChangedError extends ConflictError {
  constructor(expected: string, actual: string) {
    super(
      `The SSH host fingerprint does not match the saved record; connection blocked. Saved: ${expected}; current: ${actual}. This may indicate a server reinstall or man-in-the-middle attack; please verify before updating the fingerprint.`,
      { expected, actual },
    );
    this.name = "SshHostKeyChangedError";
  }
}

export type SshHostKeyProbeResult = {
  fingerprint: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

function normalizeHostKeySha256(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^SHA256:/i, "SHA256:");
}

export async function probeSshHostKey(input: SshConnectionParams): Promise<SshHostKeyProbeResult> {
  let captured: string | null = null;
  try {
    const result = await execRemoteCommand({
      ...input,
      hostKeySha256: null,
      onHostKeySha256: (fingerprint) => {
        captured = normalizeHostKeySha256(fingerprint);
      },
      rejectUnknownHostKeyAfterCapture: true,
      command: "printf vcontrolhub-ssh-host-key-probe",
      timeout: 15_000,
    });
    if (!captured) {
      throw new ValidationError(t("backend.ssh.failedToReadSshHostKeyFingerprintPlease"));
    }
    return { fingerprint: captured, ...result };
  } catch (error) {
    if (captured) {
      return {
        fingerprint: captured,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
      };
    }
    throw error;
  }
}

export async function requireApprovedSshHostKey(input: {
  ssh: SshConnectionParams;
  pinnedHostKeySha256?: string | null;
  approvedHostKeySha256?: string | null;
}): Promise<string | null> {
  const pinned = normalizeHostKeySha256(input.pinnedHostKeySha256);
  if (pinned) return pinned;

  const approved = normalizeHostKeySha256(input.approvedHostKeySha256);
  if (approved) {
    return approved;
  }

  const probe = await probeSshHostKey(input.ssh);
  throw new SshHostKeyApprovalRequiredError(probe.fingerprint);
}
