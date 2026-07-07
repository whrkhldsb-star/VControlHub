import { BusinessError, ConflictError, ValidationError } from "@/lib/errors";
import { execRemoteCommand, type SshConnectionParams } from "./client";

export class SshHostKeyApprovalRequiredError extends BusinessError {
  readonly hostKeySha256: string;

  constructor(hostKeySha256: string) {
    super(
      `首次连接需要确认 SSH 主机指纹：${hostKeySha256}。请勾选“我已核对并信任该 SSH 主机指纹”后再次提交。`,
      { hostKeySha256 },
    );
    this.name = "SshHostKeyApprovalRequiredError";
    this.hostKeySha256 = hostKeySha256;
  }
}

export class SshHostKeyChangedError extends ConflictError {
  constructor(expected: string, actual: string) {
    super(
      `SSH 主机指纹与已保存记录不一致，已阻止连接。已保存：${expected}；本次看到：${actual}。这可能表示服务器重装或中间人攻击，请核实后再更新指纹。`,
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
      throw new ValidationError("Failed to read SSH host key fingerprint. Please verify the target SSH service supports host key negotiation.");
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
