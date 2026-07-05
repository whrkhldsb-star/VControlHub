"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import {
  createServerProfile,
  createSshKey,
  deleteServerProfile,
  setServerDirectGatewayEnabled,
  toggleServerEnabled,
  updateServerProfile,
} from "@/lib/server/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export type ServerActionState = {
  error?: string;
  success?: string;
  relatedStorageCount?: number;
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
  await requirePermission("server:write");
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
    } as ServerActionState;
  }
}

export async function updateServerAction(
  _prevState: ServerActionState | null,
  formData: FormData,
) {
  await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const connectionType = String(
      formData.get("connectionType") ?? "PASSWORD",
    ) as "SSH_KEY" | "PASSWORD";
    const password = String(formData.get("password") ?? "");
    const sshKeyId = String(formData.get("sshKeyId") ?? "");

    await updateServerProfile(serverId, {
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
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: tr("serversPage.action.updateSuccess") } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("serversPage.action.updateFailed"),
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
  await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    await toggleServerEnabled(serverId);
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
  await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const enabled = formData.get("enabledDirectGateway") === "true";
    const directGatewayProtocol =
      formData.get("directGatewayProtocol") === "https" ? "https" : "http";
    await setServerDirectGatewayEnabled(serverId, enabled, {
      publicProtocol: directGatewayProtocol,
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
  await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const enabled = formData.get("enabled") === "true";
    const serverIds = formData.getAll("serverIds").map(String).filter(Boolean);

    if (serverIds.length === 0) {
      return { error: tr("serversPage.action.batchEmpty") } as ServerActionState;
    }

    const { prisma } = await import("@/lib/db");
    const result = await prisma.server.updateMany({
      where: { id: { in: serverIds } },
      data: { enabled },
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
  await requirePermission("server:write");
  const tr = await serverActionTranslator();

  try {
    const serverId = String(formData.get("serverId") ?? "");
    const confirmDelete = formData.get("confirmDelete") === "true";

    const { prisma } = await import("@/lib/db");
    const current = await prisma.server.findUnique({
      where: { id: serverId },
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

    await deleteServerProfile(serverId);
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
  await requirePermission("server:write");
  const sshKeys = await import("@/lib/server/service").then((mod) =>
    mod.listSshKeys(),
  );
  return { sshKeys };
}
