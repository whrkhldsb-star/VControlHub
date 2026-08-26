import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export type ServerInput = {
  name: string;
  host: string;
  port?: number;
  username?: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  managementMode?: "DIRECT" | "AGENT";
  sshKeyId?: string;
  password?: string;
  tags?: string[];
  description?: string | null;
  storagePath?: string;
  costAutoSync?: boolean;
  costMonthlyAmount?: string;
  costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
  costProvider?: string | null;
};

export type NormalizedServerInput = {
  name: string;
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  managementMode: "DIRECT" | "AGENT";
  sshKeyId: string | null;
  password: string | null;
  tags: string[];
  description: string | null;
  storagePath: string;
  costAutoSync: boolean;
  costMonthlyAmount: string | null;
  costCurrency: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
  costProvider: string | null;
};

/**
 * Reject SSH host/username values that could be reinterpreted as `ssh` CLI
 * options. A destination beginning with `-` (e.g. `-oProxyCommand=…`) becomes an
 * argv option rather than a hostname, which is arbitrary command execution on
 * the control-plane host. The command layer also inserts `--` before the
 * destination as defense-in-depth, but we reject the value at the write chokepoint
 * so a hostile identifier never reaches persistence in the first place.
 * All server create/update paths funnel through normalizeServerInput.
 */
const HOST_PATTERN = /^[A-Za-z0-9._:\-\[\]]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._@\-]+$/;

function assertSshIdentifier(kind: "host" | "username", value: string): void {
  if (value.startsWith("-")) {
    throw new ValidationError(t("backend.ssh.invalidIdentifierLeadingDash", { kind }));
  }
  const pattern = kind === "host" ? HOST_PATTERN : USERNAME_PATTERN;
  if (!pattern.test(value)) {
    throw new ValidationError(t("backend.ssh.invalidIdentifierChars", { kind }));
  }
}

export function normalizeServerInput(
  input: ServerInput,
): NormalizedServerInput {
  const host = input.host.trim();
  const username = input.username?.trim() || "root";
  assertSshIdentifier("host", host);
  assertSshIdentifier("username", username);
  return {
    name: input.name.trim(),
    host,
    port: input.port ?? 22,
    username,
    connectionType: input.connectionType ?? "SSH_KEY",
    managementMode: input.managementMode ?? "DIRECT",
    sshKeyId: input.sshKeyId?.trim() || null,
    password: input.password?.trim() || null,
    tags: Array.from(
      new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
    ),
    description: input.description?.trim() || null,
    storagePath: input.storagePath?.trim() || "/root/drive",
    costAutoSync: Boolean(input.costAutoSync),
    costMonthlyAmount: input.costMonthlyAmount?.trim() || null,
    costCurrency: input.costCurrency ?? "CNY",
    costProvider: input.costProvider?.trim() || null,
  };
}

export function getServerConnectionSummary(input: {
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  sshKeyName?: string | null;
}) {
  if (input.connectionType === "PASSWORD") {
    return `${input.username}@${input.host}:${input.port}, using password connection`;
  }
  return `${input.username}@${input.host}:${input.port}, using SSH key ${input.sshKeyName ?? "unknown"}`;
}
