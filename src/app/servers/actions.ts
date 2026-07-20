"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import {
  createServerProfile,
  createSshKey,
  deleteServerProfile,
  setServerDirectGatewayEnabled,
  toggleServerEnabled,
  updateServerProfile,
} from "@/lib/server/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { SshHostKeyApprovalRequiredError } from "@/lib/ssh/host-key";

export type ServerActionState = {
  error?: string;
  success?: string;
  relatedStorageCount?: number;
  hostKeySha256?: string;
};

function parseTags(raw: string) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function serverActionTranslator() {
  const locale = await getServerLocale();
  return (key: string) => t(key, locale);
}

export async function createServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const name = String(formData.get("name") ?? "");
    const host = String(formData.get("host") ?? "");
    const port = Number(String(formData.get("port") ?? "22"));
    const username = String(formData.get("username") ?? "") || undefined;
    const connectionType = String(
      formData.get("connectionType") ?? "SSH_KEY",
    ) as "SSH_KEY" | "PASSWORD";
    const sshKeyId = String(formData.get("sshKeyId") ?? "") || undefined;
    const password = String(formData.get("password") ?? "") || undefined;
    const description = String(formData.get("description") ?? "");
    const tags = parseTags(String(formData.get("tags") ?? ""));
    const enableDirectGateway = formData.get("enableDirectGateway") === "on";
    const directGatewayProtocol =
      formData.get("directGatewayProtocol") === "https" ? "https" : "http";
    const storagePath = String(formData.get("storagePath") ?? "/root/drive");
    const costAutoSync = formData.get("costAutoSync") === "on";
    const costMonthlyAmount = String(formData.get("costMonthlyAmount") ?? "");
    const costCurrency = String(formData.get("costCurrency") ?? "CNY") as "CNY" | "USD" | "EUR" | "JPY" | "HKD";
    const costProvider = String(formData.get("costProvider") ?? "");
    const approvedHostKeySha256 = String(formData.get("approvedHostKeySha256") ?? "") || undefined;

    const created = await createServerProfile({
      name,
      host,
      port,
      username,
      connectionType,
      sshKeyId,
      password,
      description,
      tags,
      enableDirectGateway,
      directGatewayProtocol,
      storagePath,
      costAutoSync,
      costMonthlyAmount,
      costCurrency,
      costProvider,
      approvedHostKeySha256,
    }, session);

    await auditUserAction(session.userId, "server.create", {
      serverId: created.id,
      name,
      host,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return {
      success:
        created.onboardingWarnings.length > 0
          ? tr("serversPage.action.createWithWarnings").replace("{warnings}", created.onboardingWarnings.join(" "))
          : tr("serversPage.action.createSuccess"),
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.createFailed"),
      ...(error instanceof SshHostKeyApprovalRequiredError ? { hostKeySha256: error.hostKeySha256 } : {}),
    } as ServerActionState;
  }
}

export async function updateServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const connectionType = String(
      formData.get("connectionType") ?? "PASSWORD",
    ) as "SSH_KEY" | "PASSWORD";
    const password = String(formData.get("password") ?? "");
    const sshKeyId = String(formData.get("sshKeyId") ?? "");
    const approvedHostKeySha256 = String(formData.get("approvedHostKeySha256") ?? "") || undefined;

    const storagePathRaw = String(formData.get("storagePath") ?? "").trim();
    const repairStoragePath = formData.get("repairStoragePath") === "on";
    const changes = {
      name: String(formData.get("name") ?? ""),
      host: String(formData.get("host") ?? ""),
      port: Number(String(formData.get("port") ?? "22")),
      username: String(formData.get("username") ?? "") || undefined,
      connectionType,
      sshKeyId:
        connectionType === "SSH_KEY" ? sshKeyId || undefined : undefined,
      password:
        connectionType === "PASSWORD" && password ? password : undefined,
      description: String(formData.get("description") ?? ""),
      tags: parseTags(String(formData.get("tags") ?? "")),
      costAutoSync: formData.get("costAutoSync") === "on",
      costMonthlyAmount: String(formData.get("costMonthlyAmount") ?? ""),
      costCurrency: String(formData.get("costCurrency") ?? "CNY") as "CNY" | "USD" | "EUR" | "JPY" | "HKD",
      costProvider: String(formData.get("costProvider") ?? ""),
      approvedHostKeySha256,
      ...(storagePathRaw ? { storagePath: storagePathRaw } : {}),
      repairStoragePath,
    };

    const updated = await updateServerProfile(serverId, changes, session);

    await auditUserAction(session.userId, "server.update", {
      serverId,
      fields: Object.keys(changes),
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    const warnings =
      updated && typeof updated === "object" && "onboardingWarnings" in updated
        ? (updated as { onboardingWarnings?: string[] }).onboardingWarnings ?? []
        : [];
    return {
      success:
        warnings.length > 0
          ? tr("serversPage.action.updateWithWarnings").replace("{warnings}", warnings.join(" "))
          : tr("serversPage.action.updateSuccess"),
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.updateFailed"),
      ...(error instanceof SshHostKeyApprovalRequiredError ? { hostKeySha256: error.hostKeySha256 } : {}),
    } as ServerActionState;
  }
}

export async function createSshKeyAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const uploadedFile = formData.get("ppkFile");
    const ppkContent =
      uploadedFile instanceof File && uploadedFile.size > 0
        ? await uploadedFile.text()
        : null;

    await createSshKey({
      name: String(formData.get("name") ?? ""),
      publicKey: String(formData.get("publicKey") ?? ""),
      privateKey: String(formData.get("privateKey") ?? "") || null,
      ppkContent,
      ppkPassphrase: String(formData.get("ppkPassphrase") ?? "") || null,
      passphrase: String(formData.get("passphrase") ?? "") || null,
      privateKeyEncryptionMode: (String(
        formData.get("privateKeyEncryptionMode") ?? "none",
      ) || "none") as "none" | "same-as-ppk" | "custom",
      privateKeyOutputPassphrase:
        String(formData.get("privateKeyOutputPassphrase") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      createdById: session.userId,
      session,
    });

    await auditUserAction(session.userId, "ssh_key.create", {
      name: String(formData.get("name") ?? ""),
    });

    revalidatePath("/");
    revalidatePath("/servers");

    return {
      success: tr("serversPage.action.sshKeyCreated"),
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.sshKeyCreateFailed"),
    } as ServerActionState;
  }
}

export async function toggleServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const updated = await toggleServerEnabled(serverId, session);
    const newState = updated.enabled;
    await auditUserAction(session.userId, "server.toggle", {
      serverId,
      enabled: newState,
    });
    revalidatePath("/");
    revalidatePath("/servers");
    return { success: tr("serversPage.action.toggleSuccess") } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.toggleFailed"),
    } as ServerActionState;
  }
}

export async function toggleDirectGatewayAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const enabled = formData.get("enabledDirectGateway") === "true";
    const directGatewayProtocol =
      formData.get("directGatewayProtocol") === "https" ? "https" : "http";
    await setServerDirectGatewayEnabled(serverId, enabled, {
      publicProtocol: directGatewayProtocol,
    });
    await auditUserAction(session.userId, "server.direct_gateway.toggle", {
      serverId,
      enabled,
      protocol: directGatewayProtocol,
    });
    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");
    return {
      success: enabled
        ? tr("serversPage.action.directGatewayEnabled")
        : tr("serversPage.action.directGatewayDisabled"),
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.directGatewayFailed"),
    } as ServerActionState;
  }
}

export async function batchToggleServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const enabled = formData.get("enabled") === "true";
    const serverIds = formData.getAll("serverIds").map(String).filter(Boolean);

    if (serverIds.length === 0) {
      return { error: tr("serversPage.action.batchEmpty") } as ServerActionState;
    }

    const { prisma } = await import("@/lib/db");
    const { teamWhere } = await import("@/lib/auth/team-scope");
    const result = await prisma.server.updateMany({
      where: { id: { in: serverIds }, ...teamWhere(session) },
      data: { enabled },
    });
    await auditUserAction(session.userId, "server.batch_toggle", {
      enabled,
      requestedCount: serverIds.length,
      updatedCount: result.count,
      serverIds,
    });

    revalidatePath("/");
    revalidatePath("/servers");

    return {
      success: enabled
        ? tr("serversPage.action.batchEnabled").replace("{count}", String(result.count))
        : tr("serversPage.action.batchDisabled").replace("{count}", String(result.count)),
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.batchFailed"),
    } as ServerActionState;
  }
}

export async function deleteServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const confirmDelete = formData.get("confirmDelete") === "true";

    const { prisma } = await import("@/lib/db");
    const { teamWhere } = await import("@/lib/auth/team-scope");
    const current = await prisma.server.findFirst({
      where: { id: serverId, ...teamWhere(session) },
      select: { name: true },
    });
    if (!current) {
      return { error: tr("serversPage.action.notFound") } as ServerActionState;
    }

    // Query related storage nodes count
    const relatedStorageCount = await prisma.storageNode.count({
      where: { serverId },
    });

    if (!confirmDelete) {
      return {
        relatedStorageCount,
      } as ServerActionState;
    }

    const confirmName = String(formData.get("confirmName") ?? "").trim();
    if (confirmName !== current.name) {
      return {
        relatedStorageCount,
        error: tr("serversPage.action.deleteConfirmName").replace("{name}", current.name),
      } as ServerActionState;
    }

    const serverName = current.name;
    await deleteServerProfile(serverId, session);
    await auditUserAction(session.userId, "server.delete", {
      serverId,
      name: serverName,
    });
    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    return { success: tr("serversPage.action.deleteSuccess") } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.deleteFailed"),
    } as ServerActionState;
  }
}

export async function getServerFormOptions() {
  const session = await requirePermission("server:write");
  const sshKeys = await import("@/lib/server/service").then((mod) =>
    mod.listSshKeys(session),
  );
  return { sshKeys };
}
