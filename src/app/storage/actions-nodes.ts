"use server";

import { revalidatePath } from "next/cache";

import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { serverT } from "@/lib/i18n/server-locale";
import {
  checkStorageNodeHealth,
  createStorageNode,
  deleteStorageNode,
  listStorageNodes,
  updateStorageNode,
} from "@/lib/storage/service";
import { listServerProfiles } from "@/lib/server/service";

import type { StorageActionState } from "./actions-helpers";

export async function getStorageFormOptions() {
  // Called from files page for users with storage:write OR storage:manage-node.
  // Scope servers by session team; do not require manage-node here.
  const session = await requireSession();
  const [servers, nodes] = await Promise.all([
    listServerProfiles(session),
    listStorageNodes(),
  ]);
  return {
    servers: servers.map((server: (typeof servers)[number]) => ({
      id: server.id,
      name: server.name,
      host: server.host,
    })),
    nodes: nodes.map((node: (typeof nodes)[number]) => ({
      id: node.id,
      name: node.name,
      driver: node.driver,
    })),
  };
}

export async function checkStorageNodeHealthAction(storageNodeId: string) {
  await requirePermission("storage:manage-node");

  const t = await serverT();
  try {
    const result = await checkStorageNodeHealth(storageNodeId);
    revalidatePath("/storage");
    revalidatePath("/files");
    const statusLabel = result.healthStatus === "HEALTHY"
      ? t("storagePage.action.healthCheckCompletedHealthy")
      : t("storagePage.action.healthCheckCompletedError");
    return {
      success: t("storagePage.action.healthCheckCompleted").replace("{status}", statusLabel),
      health: result,
    } satisfies StorageActionState & {
      health: Awaited<ReturnType<typeof checkStorageNodeHealth>>;
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.healthCheckFailed"),
    } satisfies StorageActionState;
  }
}

export async function createStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:manage-node");

  const t = await serverT();
  try {
    const driver = String(formData.get("driver") ?? "LOCAL").toUpperCase() as
      | "LOCAL"
      | "SFTP";
    const portRaw = String(formData.get("port") ?? "").trim();
    const serverIdRaw = String(formData.get("serverId") ?? "").trim();
    const hostRaw = String(formData.get("host") ?? "").trim();
    const usernameRaw = String(formData.get("username") ?? "").trim();

    const node = await createStorageNode({
      name: String(formData.get("name") ?? ""),
      driver,
      isDefault: String(formData.get("isDefault") ?? "") === "on",
      basePath: String(formData.get("basePath") ?? ""),
      directAccessMode: String(formData.get("directAccessMode") ?? "PROXY") as
        | "PROXY"
        | "DIRECT"
        | "AUTO",
      publicBaseUrl:
        String(formData.get("publicBaseUrl") ?? "").trim() || undefined,
      directAccessExpiresSeconds: Number(
        String(formData.get("directAccessExpiresSeconds") ?? "300").trim() ||
          300,
      ),
      serverId: serverIdRaw || undefined,
      host: hostRaw || undefined,
      port: portRaw ? Number(portRaw) : undefined,
      username: usernameRaw || undefined,
    });

    await auditUserAction(session.userId, "storage.node.create", {
      storageNodeId: node.id,
      name: node.name,
      driver: node.driver,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: t("storagePage.action.createNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.createNodeFailed"),
    } satisfies StorageActionState;
  }
}

export async function updateStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:manage-node");

  const t = await serverT();
  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
    const driver = String(formData.get("driver") ?? "")
      .trim()
      .toUpperCase() as "LOCAL" | "SFTP" | "";
    const portRaw = String(formData.get("port") ?? "").trim();
    const serverIdRaw = String(formData.get("serverId") ?? "").trim();
    const hostRaw = String(formData.get("host") ?? "").trim();
    const usernameRaw = String(formData.get("username") ?? "").trim();
    const isDefaultRaw = String(formData.get("isDefault") ?? "").trim();

    if (!storageNodeId) {
      return { error: t("storagePage.action.missingNodeParam") } satisfies StorageActionState;
    }

    await updateStorageNode({
      storageNodeId,
      name: String(formData.get("name") ?? "").trim() || undefined,
      driver: driver === "LOCAL" || driver === "SFTP" ? driver : undefined,
      basePath: String(formData.get("basePath") ?? "").trim() || undefined,
      directAccessMode: ["PROXY", "DIRECT", "AUTO"].includes(
        String(formData.get("directAccessMode") ?? ""),
      )
        ? (String(formData.get("directAccessMode")) as
            | "PROXY"
            | "DIRECT"
            | "AUTO")
        : undefined,
      publicBaseUrl: String(formData.get("publicBaseUrl") ?? "").trim(),
      directAccessExpiresSeconds: Number(
        String(formData.get("directAccessExpiresSeconds") ?? "").trim() || 300,
      ),
      isDefault:
        isDefaultRaw === "on"
          ? true
          : isDefaultRaw === "off"
            ? false
            : undefined,
      serverId: serverIdRaw || null,
      host: hostRaw || null,
      port: portRaw ? Number(portRaw) : undefined,
      username: usernameRaw || null,
    });

    await auditUserAction(session.userId, "storage.node.update", { storageNodeId });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: t("storagePage.action.updateNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.updateNodeFailed"),
    } satisfies StorageActionState;
  }
}

export async function deleteStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:manage-node");

  const t = await serverT();
  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();

    if (!storageNodeId) {
      return { error: t("storagePage.action.missingNodeParam") } satisfies StorageActionState;
    }

    await deleteStorageNode(storageNodeId);

    await auditUserAction(session.userId, "storage.node.delete", { storageNodeId });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: t("storagePage.action.deleteNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.deleteNodeFailed"),
    } satisfies StorageActionState;
  }
}
