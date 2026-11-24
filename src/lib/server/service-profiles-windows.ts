import { Prisma } from "@prisma/client";

import { serverOriginData, teamCreateData } from "@/lib/auth/team-scope";
import { encrypt } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { TFn } from "@/lib/i18n/core";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { rdpCertificatePinSupported } from "@/lib/rdp/certificate";
import { rdpProfileSchema } from "@/lib/rdp/protocol";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { requireApprovedSshHostKey } from "@/lib/ssh/host-key";
import { decryptServerPassword, encryptServerPassword } from "@/lib/ssh/ssh-key-crypto";
import { removeAgentFromHost, resetAgentForModeChange } from "./agent-service";
import { createServerSchema, type CreateServerInput, type CreateServerPayload } from "./schema";
import { findServerProfileForSession, savedProfileBinding, SERVER_PROFILE_INCLUDE, type ServerProfileRecord } from "./service-profile-includes";
import {
  assertNoDuplicateServerHost,
  enrichServerForSession,
  safeRevalidatePath,
  sessionForTeamWhere,
  type ProfileSession,
} from "./service-internals";
import type { UpdateServerInput } from "./service-profiles";
import { revokeInheritedSftpShares, revokeNodeShares } from "@/lib/storage/node-root";
import { firstSchemaSentence } from "@/lib/i18n/schema-copy";

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
  // A pin this gateway cannot enforce would make the node unreachable (A3-01):
  // refuse it at save time with the reason, not at the first connection.
  if (payload.rdpCertificateSha256 && !rdpCertificatePinSupported()) throw new ValidationError(t("backend.server.rdpPinUnsupported"));
  const release = await acquireAdvisoryLock("server-host", payload.host);
  try {
    await assertNoDuplicateServerHost(payload, { session: sessionForTeamWhere(session) });
    const serverData = {
      name: payload.name, host: payload.host, port: payload.port, username: payload.username,
      operatingSystem: "WINDOWS", connectionType: "PASSWORD",
      // AGENT mode on Windows is connected manually afterwards via the
      // PowerShell install command shown on the node card.
      managementMode: payload.managementMode,
      password: payload.windowsSftpEnabled ? encryptServerPassword(payload.windowsSftpPassword!) : null,
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
      ...(session ? { ...teamCreateData(session), ...serverOriginData(session) } : {}),
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
    return { ...await enrichServerForSession(refreshed ?? server, session), onboardingWarnings, draftReason: null };
  } finally { await release(); }
}

export async function updateWindowsServerProfile(
  serverId: string,
  current: ServerProfileRecord,
  input: UpdateServerInput,
  session: ProfileSession | null | undefined,
  t: TFn,
  reconfigureAgent: boolean,
) {
  if (input.enableDirectGateway || input.repairStoragePath || input.removeSshCredential || input.sshKeyId || input.password) {
    throw new ValidationError(t("backend.server.linuxOnly"));
  }
  const rdpInput = input as Partial<Extract<CreateServerInput, { operatingSystem: "WINDOWS" }>>;
  const nextManagementMode = input.managementMode ?? current.managementMode;
  const modeChanged = nextManagementMode !== current.managementMode;
  if (modeChanged && nextManagementMode === "DIRECT" && !rdpInput.rdpPassword) {
    throw new ValidationError(t("backend.server.windowsPasswordRequiredOnUpdate"));
  }
  const payload = rdpProfileSchema.parse({
    ...current, ...input, password: rdpInput.rdpPassword ?? "retained",
    domain: rdpInput.rdpDomain ?? current.rdpDomain ?? "",
    ignoreCertificate: rdpInput.rdpIgnoreCertificate ?? current.rdpIgnoreCertificate,
    certificateSha256: rdpInput.rdpCertificateSha256 ?? current.rdpCertificateSha256 ?? "",
    description: input.description ?? current.description ?? "",
  });
  if (rdpInput.rdpPassword === undefined && !current.rdpPassword) throw new ValidationError(t("backend.server.windowsPasswordRequiredOnUpdate"));
  // The stored password belongs to the account the node used so far: keeping
  // it for another user name or domain makes every login fail (and repeated
  // failures lock the new account), so another account needs its password.
  const sameAccount = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  if (rdpInput.rdpPassword === undefined && (!sameAccount(payload.username, current.username) || !sameAccount(payload.domain, current.rdpDomain))) {
    throw new ValidationError(t("backend.server.windowsAccountNeedsPassword"));
  }
  if (input.windowsSftpEnabled && current.storageNode && current.storageNode.driver !== "SFTP") {
    throw new ValidationError(t("backend.server.windowsStorageRequiresSftp"));
  }
  const existingSftp = current.storageNode?.driver === "SFTP" ? current.storageNode : null;
  const configureSftp = input.windowsSftpEnabled === true;
  if (existingSftp && payload.host !== current.host && !configureSftp) {
    throw new ValidationError(t("backend.server.windowsSftpReverify"));
  }
  // An RDP login sends the password to whatever answers at the address: a new endpoint needs it typed again,
  // or an editor who was never told it could point the node at their own host and collect it.
  if (rdpInput.rdpPassword === undefined && current.rdpPassword && (payload.host !== current.host || payload.port !== current.port)) {
    throw new ValidationError(t("backend.server.endpointChangeNeedsPassword"));
  }
  const nextSftp = configureSftp ? {
    port: input.windowsSftpPort ?? existingSftp?.port ?? 22,
    username: input.windowsSftpUsername?.trim() || existingSftp?.username || "",
    password: input.windowsSftpPassword || (current.password ? decryptServerPassword(current.password) : ""),
    basePath: input.windowsSftpPath?.trim() || existingSftp?.basePath || "",
  } : null;
  // The SFTP check below logs in with this password; the stored one may only go back to the endpoint it was set for.
  if (nextSftp && !input.windowsSftpPassword && current.password && (
    payload.host !== current.host ||
    nextSftp.port !== (existingSftp?.port ?? 22) ||
    nextSftp.username !== (existingSftp?.username ?? "")
  )) {
    throw new ValidationError(t("backend.server.endpointChangeNeedsPassword"));
  }
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
    if (!valid.success) throw new ValidationError(firstSchemaSentence(valid.error) ?? "Invalid SFTP configuration");
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
  // Before the lock, not between taking it and the block that releases it: thrown there, each refusal kept the
  // host lock and one of the lock pool's few connections until the process restarted.
  if (payload.certificateSha256 && !rdpCertificatePinSupported()) throw new ValidationError(t("backend.server.rdpPinUnsupported"));
  const release = await acquireAdvisoryLock("server-host", payload.host);
  try {
    await assertNoDuplicateServerHost(payload, { excludeId: serverId, session: sessionForTeamWhere(session) });
    const onboardingWarnings: string[] = [];
    if (reconfigureAgent && current.managementMode === "AGENT") {
      const cleanup = await removeAgentFromHost(serverId);
      if (!cleanup.removed) onboardingWarnings.push(t(cleanup.requested ? "backend.server.agentCleanupRequested" : "backend.server.agentCleanupPending"));
    }
    const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.server.update({ where: { id: serverId, teamId: current.teamId, host: current.host, port: current.port, username: current.username, managementMode: current.managementMode, hostKeySha256: current.hostKeySha256, directGatewayKeyVersion: current.directGatewayKeyVersion, enabled: current.enabled, password: current.password, rdpPassword: current.rdpPassword }, data: {
      ...(reconfigureAgent ? { ...resetAgentForModeChange(), onboardingStatus: "NEEDS_ATTENTION", onboardingLastError: null } : {}),
      name: payload.name, host: payload.host, port: payload.port, username: payload.username,
      description: payload.description, tags: payload.tags,
      managementMode: nextManagementMode,
      ...(nextSftp && { hostKeySha256: nextSftpHostKey }),
      ...(nextSftp && input.windowsSftpPassword && { password: encryptServerPassword(nextSftp.password) }),
      ...(rdpInput.rdpPassword !== undefined && { rdpPassword: encrypt(payload.password) }),
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
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    } });
    if (nextSftp) {
      if (existingSftp) {
        const rootChanged = nextSftp.basePath !== existingSftp.basePath || nextSftp.port !== existingSftp.port
          || nextSftp.username !== existingSftp.username || existingSftp.host != null;
        await tx.storageNode.update({ where: {
          id: existingSftp.id, serverId, teamId: current.teamId, driver: "SFTP",
          basePath: existingSftp.basePath, port: existingSftp.port, username: existingSftp.username, host: existingSftp.host,
        }, data: {
          ...(rootChanged ? revokeNodeShares() : {}),
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
    // Node deletion holds its row before cascading to shares. Take any node
    // update above before revoking links to the inherited server endpoint.
    await revokeInheritedSftpShares(tx, current, payload);
    return saved;
    });
    if (reconfigureAgent && nextManagementMode === "AGENT") onboardingWarnings.push(t("backend.server.agentInstallPending"));
    const refreshed = await findServerProfileForSession(serverId, sessionForTeamWhere(session), savedProfileBinding(updated));
    if (!refreshed) throw new NotFoundError(t("backend.server.nodeNotFound"));
    safeRevalidatePath("/storage");
    safeRevalidatePath("/files");
    return { ...await enrichServerForSession(refreshed, session), onboardingWarnings };
  } finally { await release(); }
}
