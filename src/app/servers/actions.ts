"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { createServerProfile, createSshKey, deleteServerProfile, setServerDirectGatewayEnabled, toggleServerEnabled } from "@/lib/server/service";

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

export async function createServerAction(_prevState: ServerActionState | null, formData: FormData) {
 await requirePermission("server:write");

 try {
  const name = String(formData.get("name") ?? "");
  const host = String(formData.get("host") ?? "");
  const port = Number(String(formData.get("port") ?? "22"));
  const username = String(formData.get("username") ?? "");
  const connectionType = String(formData.get("connectionType") ?? "SSH_KEY") as "SSH_KEY" | "PASSWORD";
  const sshKeyId = String(formData.get("sshKeyId") ?? "") || undefined;
  const password = String(formData.get("password") ?? "") || undefined;
  const description = String(formData.get("description") ?? "");
  const tags = parseTags(String(formData.get("tags") ?? ""));
  const enableDirectGateway = formData.get("enableDirectGateway") === "on";
  const storagePath = String(formData.get("storagePath") ?? "/root/drive");

  await createServerProfile({
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
   storagePath,
  });

 revalidatePath("/");
 revalidatePath("/servers");
 revalidatePath("/storage");
 revalidatePath("/files");

 return {
 success: "VPS 节点已纳管，可继续在审批中心投递命令。",
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "纳管节点失败",
    } as ServerActionState;
  }
}

export async function createSshKeyAction(_prevState: ServerActionState | null, formData: FormData) {
  const session = await requirePermission("server:write");

  try {
    const uploadedPpk = formData.get("ppkFile");
    const ppkContent = uploadedPpk instanceof File && uploadedPpk.size > 0 ? await uploadedPpk.text() : null;

    await createSshKey({
      name: String(formData.get("name") ?? ""),
      publicKey: String(formData.get("publicKey") ?? ""),
      privateKey: String(formData.get("privateKey") ?? "") || null,
      ppkContent,
      ppkPassphrase: String(formData.get("ppkPassphrase") ?? "") || null,
      privateKeyEncryptionMode: ((String(formData.get("privateKeyEncryptionMode") ?? "none") || "none") as "none" | "same-as-ppk" | "custom"),
      privateKeyOutputPassphrase: String(formData.get("privateKeyOutputPassphrase") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      createdById: session.userId,
    });

    revalidatePath("/");
    revalidatePath("/servers");

    return {
      success: "SSH 密钥已添加，可立即用于 VPS 纳管与命令执行。",
    } as ServerActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "添加 SSH 密钥失败",
    } as ServerActionState;
  }
}

export async function toggleServerAction(_prevState: ServerActionState | null, formData: FormData) {
 await requirePermission("server:write");

 try {
 const serverId = String(formData.get("serverId") ?? "");
 await toggleServerEnabled(serverId);
 revalidatePath("/");
 revalidatePath("/servers");
 return { success: "节点状态已更新。" } as ServerActionState;
 } catch (error) {
 return { error: error instanceof Error ? error.message : "更新节点状态失败" } as ServerActionState;
 }
}

export async function toggleDirectGatewayAction(_prevState: ServerActionState | null, formData: FormData) {
 await requirePermission("server:write");

 try {
  const serverId = String(formData.get("serverId") ?? "");
  const enabled = formData.get("enabledDirectGateway") === "true";
  await setServerDirectGatewayEnabled(serverId, enabled);
  revalidatePath("/");
  revalidatePath("/servers");
  revalidatePath("/storage");
  revalidatePath("/files");
  return { success: enabled ? "目标直连已启用，上传、下载和在线浏览将优先直连。" : "已切回网站中转，并已删除目标服务器直连服务。" } as ServerActionState;
 } catch (error) {
  return { error: error instanceof Error ? error.message : "切换目标直连失败" } as ServerActionState;
 }
}

export async function batchToggleServerAction(_prevState: ServerActionState | null, formData: FormData) {
 await requirePermission("server:write");

 try {
  const enabled = formData.get("enabled") === "true";
  const serverIds = formData.getAll("serverIds").map(String).filter(Boolean);

  if (serverIds.length === 0) {
    return { error: "请先选择至少 1 台节点" } as ServerActionState;
  }

  const { prisma } = await import("@/lib/db");
  const result = await prisma.server.updateMany({
    where: { id: { in: serverIds } },
    data: { enabled },
  });

  revalidatePath("/");
  revalidatePath("/servers");

  return {
    success: enabled ? `已批量启用 ${result.count} 台节点。` : `已批量停用 ${result.count} 台节点。`,
  } as ServerActionState;
 } catch (error) {
  return { error: error instanceof Error ? error.message : "批量更新节点状态失败" } as ServerActionState;
 }
}

export async function deleteServerAction(_prevState: ServerActionState | null, formData: FormData) {
 await requirePermission("server:write");

 try {
 const serverId = String(formData.get("serverId") ?? "");
 const confirmDelete = formData.get("confirmDelete") === "true";

 // Query related storage nodes count
 const { prisma } = await import("@/lib/db");
 const relatedStorageCount = await prisma.storageNode.count({ where: { serverId } });

 if (!confirmDelete) {
 return {
 relatedStorageCount,
 } as ServerActionState;
 }

 await deleteServerProfile(serverId);
 revalidatePath("/");
 revalidatePath("/servers");
 revalidatePath("/storage");
 return { success: "节点已删除。" } as ServerActionState;
 } catch (error) {
 return { error: error instanceof Error ? error.message : "删除节点失败" } as ServerActionState;
 }
}

export async function getServerFormOptions() {
  await requirePermission("server:write");
  const sshKeys = await import("@/lib/server/service").then((mod) => mod.listSshKeys());
  return { sshKeys };
}
