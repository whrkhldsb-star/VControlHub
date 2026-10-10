import { Prisma } from "@prisma/client";

import { teamCreateData } from "@/lib/auth/team-scope";
import { encrypt } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { TFn } from "@/lib/i18n/core";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { rdpProfileSchema } from "@/lib/rdp/protocol";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { requireApprovedSshHostKey } from "@/lib/ssh/host-key";
import { decryptServerPassword, encryptServerPasswordIfPlain } from "@/lib/ssh/ssh-key-crypto";
import { uninstallServerAgent } from "./agent-service";
import { createServerSchema, type CreateServerInput, type CreateServerPayload } from "./schema";
import { SERVER_PROFILE_INCLUDE, type ServerProfileRecord } from "./service-profile-includes";
import {
  assertNoDuplicateServerHost,
  enrichServer,
  safeRevalidatePath,
  sessionForTeamWhere,
  type ProfileSession,
} from "./service-internals";
import type { UpdateServerInput } from "./service-profiles";

/**
 * Windows nodes: an RDP profile plus an optional SFTP storage node. AGENT mode
 * is connected manually afterwards via the PowerShell command on the node card.
 */
export async function createWindowsServerProfile(
  payload: Extract<CreateServerPayload, { operatingSystem: "WINDOWS" }>,
  session: ProfileSession | null | undefined,
  t: TFn,
) {
  let sftpHostKey: string | null = null;
  if (payload.windowsSftpEnabled) {
    const ssh = {
      host: payload.host,
      port: payload.windowsSftpPort,
      username: payload.windowsSftpUsername!,
      password: payload.windowsSftpPassword!,
    };
    sftpHostKey = await requireApprovedSshHostKey({
      ssh,
      approvedHostKeySha256: payload.approvedHostKeySha256 || payload.hostKeySha256,
    });
    await listRemoteDirectory({ ...ssh, hostKeySha256: sftpHostKey, remotePath: payload.windowsSftpPath! });
  }
  const release = await acquireAdvisoryLock("server-host", payload.host);
  try {
    await assertNoDuplicateServerHost(payload, { session: sessionForTeamWhere(session) });
    const serverData = {
      name: payload.name, host: payload.host, port: payload.port, username: payload.username,
      operatingSystem: "WINDOWS", connectionType: "PASSWORD",
      // AGENT mode on Windows is connected manually afterwards via the
      // PowerShell install command shown on the node card.
      managementMode: payload.managementMode,
      password: payload.windowsSftpEnabled ? encryptServerPasswordIfPlain(payload.windowsSftpPassword!) : null,
      sshKeyId: null, hostKeySha256: sftpHostKey, rdpPassword: encrypt(payload.rdpPassword),
      rdpDomain: payload.rdpDomain || null, rdpIgnoreCertificate: payload.rdpIgnoreCertificate,
      rdpCertificateSha256: payload.rdpCertificateSha256 || null,
      // Windows VPS nodes carry the same billing fields as Linux ones so the
      // cost pages can cover the whole fleet.
      costAutoSync: payload.costAutoSync,
      costMonthlyAmount: payload.costMonthlyAmount ? new Prisma.Decimal(payload.costMonthlyAmount) : null,
      costCurrency: payload.costCurrency,
      costProvider: payload.costProvider || null,
      description: payload.description, tags: payload.tags, enabled: true,
      onboardingStatus: "NEEDS_ATTENTION", onboardingLastError: null,
      ...(session ? teamCreateData(session) : {}),
    } as const;
    const server = payload.windowsSftpEnabled
      ? await prisma.$transaction(async (tx) => {
          const created = await tx.server.create({ data: serverData, include: SERVER_PROFILE_INCLUDE });
          await tx.storageNode.create({ data: {
            name: `${payload.name} storage`, driver: "SFTP", basePath: payload.windowsSftpPath!,
            host: null, port: payload.windowsSftpPort, username: payload.windowsSftpUsername!,
            hostKeySha256: sftpHostKey, serverId: created.id, directAccessMode: "PROXY",
            ...(session ? teamCreateData(session) : {}),
          } });
          return created;
        })
      : await prisma.server.create({ data: serverData, include: SERVER_PROFILE_INCLUDE });
    const onboardingWarnings = payload.managementMode === "AGENT"
      ? [t("backend.server.agentInstallPending")]
      : [];
    const refreshed = payload.windowsSftpEnabled
      ? await prisma.server.findUnique({ where: { id: server.id }, include: SERVER_PROFILE_INCLUDE })
      : server;
    safeRevalidatePath("/storage");
    safeRevalidatePath("/files");
    return { ...enrichServer(refreshed ?? server), onboardingWarnings, draftReason: null };
  } finally { await release(); }
}

export async function updateWindowsServerProfile(
  serverId: string,
  current: ServerProfileRecord,
  input: UpdateServerInput,
  session: ProfileSession | null | undefined,
  t: TFn,
) {
  if (input.enableDirectGateway || input.repairStoragePath || input.removeSshCredential || input.sshKeyId || input.password) {
    throw new ValidationError(t("backend.server.linuxOnly"));
  }
  const rdpInput = input as Partial<Extract<CreateServerInput, { operatingSystem: "WINDOWS" }>>;
  const payload = rdpProfileSchema.parse({
    ...current, ...input, password: rdpInput.rdpPassword ?? "retained",
    domain: rdpInput.rdpDomain ?? current.rdpDomain ?? "",
    ignoreCertificate: rdpInput.rdpIgnoreCertificate ?? current.rdpIgnoreCertificate,
    certificateSha256: rdpInput.rdpCertificateSha256 ?? current.rdpCertificateSha256 ?? "",
    description: input.description ?? current.description ?? "",
  });
  if (rdpInput.rdpPassword === undefined && !current.rdpPassword) throw new ValidationError();
  if (input.windowsSftpEnabled && current.storageNode && current.storageNode.driver !== "SFTP") {
    throw new ValidationError(t("backend.server.windowsStorageRequiresSftp"));
  }
  const existingSftp = current.storageNode?.driver === "SFTP" ? current.storageNode : null;
  const configureSftp = input.windowsSftpEnabled === true;
  if (existingSftp && payload.host !== current.host && !configureSftp) {
    throw new ValidationError(t("backend.server.windowsSftpReverify"));
  }
  const nextSftp = configureSftp ? {
    port: input.windowsSftpPort ?? existingSftp?.port ?? 22,
    username: input.windowsSftpUsername?.trim() || existingSftp?.username || "",
    password: input.windowsSftpPassword || (current.password ? decryptServerPassword(current.password) : ""),
    basePath: input.windowsSftpPath?.trim() || existingSftp?.basePath || "",
  } : null;
  if (current.fileProxyPort && current.fileProxyPort > 0 && (
    payload.host !== current.host ||
    (nextSftp && (nextSftp.port !== (existingSftp?.port ?? 22) ||
      nextSftp.username !== (existingSftp?.username ?? "") ||
      nextSftp.basePath !== (existingSftp?.basePath ?? "") ||
      Boolean(input.windowsSftpPassword)))
  )) {
    throw new ValidationError(t("backend.server.windowsDisableGatewayBeforeSftpEdit"));
  }
  if (nextSftp) {
    const valid = createServerSchema.safeParse({
      operatingSystem: "WINDOWS", name: payload.name, host: payload.host,
      port: payload.port, username: payload.username,
      rdpPassword: rdpInput.rdpPassword ?? "retained",
      windowsSftpEnabled: true,
      windowsSftpPort: nextSftp.port, windowsSftpUsername: nextSftp.username,
      windowsSftpPassword: nextSftp.password, windowsSftpPath: nextSftp.basePath,
    });
    if (!valid.success) throw new ValidationError(valid.error.issues[0]?.message ?? "Invalid SFTP configuration");
  }
  let nextSftpHostKey = current.hostKeySha256;
  if (nextSftp) {
    const sameEndpoint = payload.host === current.host && nextSftp.port === (existingSftp?.port ?? 22);
    const ssh = { host: payload.host, port: nextSftp.port, username: nextSftp.username, password: nextSftp.password };
    nextSftpHostKey = await requireApprovedSshHostKey({
      ssh,
      pinnedHostKeySha256: sameEndpoint ? current.hostKeySha256 : null,
      approvedHostKeySha256: input.approvedHostKeySha256,
    });
    await listRemoteDirectory({ ...ssh, hostKeySha256: nextSftpHostKey, remotePath: nextSftp.basePath });
  }
  const nextManagementMode = input.managementMode ?? current.managementMode;
  const release = await acquireAdvisoryLock("server-host", payload.host);
  try {
    await assertNoDuplicateServerHost(payload, { excludeId: serverId, session: sessionForTeamWhere(session) });
    const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.server.update({ where: { id: serverId, teamId: current.teamId }, data: {
      name: payload.name, host: payload.host, port: payload.port, username: payload.username,
      description: payload.description, tags: payload.tags,
      managementMode: nextManagementMode,
      ...(nextSftp ? { password: encryptServerPasswordIfPlain(nextSftp.password), hostKeySha256: nextSftpHostKey } : {}),
      rdpPassword: rdpInput.rdpPassword === undefined ? current.rdpPassword : encrypt(payload.password),
      rdpDomain: payload.domain || null, rdpIgnoreCertificate: payload.ignoreCertificate,
      rdpCertificateSha256: payload.certificateSha256 || null,
      // Cost fields are shared with the Linux edit form; empty amount/provider clears.
      costAutoSync: input.costAutoSync ?? current.costAutoSync,
      costMonthlyAmount:
        input.costMonthlyAmount !== undefined
          ? input.costMonthlyAmount
            ? new Prisma.Decimal(input.costMonthlyAmount)
            : null
          : current.costMonthlyAmount,
      costCurrency: input.costCurrency ?? current.costCurrency,
      costProvider: input.costProvider !== undefined ? input.costProvider || null : current.costProvider,
      enabled: input.enabled ?? current.enabled,
    }, include: SERVER_PROFILE_INCLUDE });
    if (nextSftp) {
      if (existingSftp) {
        await tx.storageNode.update({ where: { id: existingSftp.id }, data: {
          basePath: nextSftp.basePath, port: nextSftp.port, username: nextSftp.username,
          host: null, hostKeySha256: nextSftpHostKey,
        } });
      } else {
        await tx.storageNode.create({ data: {
          name: `${payload.name} storage`, driver: "SFTP", basePath: nextSftp.basePath,
          host: null, port: nextSftp.port, username: nextSftp.username,
          hostKeySha256: nextSftpHostKey, serverId,
          directAccessMode: "PROXY", ...(session ? teamCreateData(session) : {}),
        } });
      }
    }
    return saved;
    });
    const onboardingWarnings: string[] = [];
    if (nextManagementMode !== current.managementMode) {
      if (nextManagementMode === "AGENT") {
        // Agent is installed manually on Windows via the node card command.
        onboardingWarnings.push(t("backend.server.agentInstallPending"));
      } else if (current.managementMode === "AGENT") {
        const cleanup = await uninstallServerAgent(serverId);
        if (!cleanup.removed) onboardingWarnings.push(t("backend.server.agentCleanupPending"));
      }
    }
    const refreshed = nextSftp ? await prisma.server.findUnique({ where: { id: serverId }, include: SERVER_PROFILE_INCLUDE }) : updated;
    safeRevalidatePath("/storage");
    safeRevalidatePath("/files");
    return { ...enrichServer(refreshed ?? updated), onboardingWarnings };
  } finally { await release(); }
}
