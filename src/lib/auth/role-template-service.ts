import { apiCopy } from "@/lib/i18n/api-copy";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/auth/rbac";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export const roleTemplateStorageGrantSchema = z.object({
  storageNodeId: z.string().min(1),
  pathPrefix: z.string().max(500).default(""),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  quotaBytes: z.string().nullable().optional(),
  maxFileBytes: z.string().nullable().optional(),
});

export const roleTemplateServerGrantSchema = z.object({
  serverId: z.string().min(1),
  canRead: z.boolean(),
  canConnect: z.boolean(),
  canManage: z.boolean(),
  canFileRead: z.boolean(),
  canFileWrite: z.boolean(),
  canFileDelete: z.boolean(),
});

export const roleTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1)).max(20).default([]),
  permissions: z.array(z.string().trim().min(1)).max(500).default([]),
  storageAccess: z.array(roleTemplateStorageGrantSchema).max(100).default([]),
  serverAccess: z.array(roleTemplateServerGrantSchema).max(500).default([]),
});

export type RoleTemplateInput = z.infer<typeof roleTemplateInputSchema>;

function serialize(row: {
  id: string;
  name: string;
  description: string | null;
  roleKeys: string[];
  permissions: string[];
  dataScope: Prisma.JsonValue;
  isBuiltin: boolean;
  createdBy: string | null;
  teamId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const scope = row.dataScope && typeof row.dataScope === "object" && !Array.isArray(row.dataScope)
    ? row.dataScope as Record<string, unknown>
    : {};
  const storageAccess = Array.isArray(scope.storageAccess) ? scope.storageAccess : [];
  const serverAccess = Array.isArray(scope.serverAccess) ? scope.serverAccess : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roleKeys: row.roleKeys,
    permissions: row.permissions,
    storageAccess,
    serverAccess,
    isBuiltin: row.isBuiltin,
    createdBy: row.createdBy,
    teamId: row.teamId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateInput(input: unknown, teamId: string) {
  const parsed = roleTemplateInputSchema.parse(input);
  const validPermissionSet = new Set<string>(ALL_PERMISSIONS);
  const invalidPermissions = parsed.permissions.filter((key) => !validPermissionSet.has(key));
  if (invalidPermissions.length > 0) {
    throw new ValidationError(apiCopy("apiCopy.unknown.permissions.9b3e626f", { v0: String(invalidPermissions.join(", ")) }));
  }
  const knownRoles = await prisma.role.findMany({
    where: { key: { in: parsed.roleKeys } },
    select: { key: true },
    take: parsed.roleKeys.length || 1,
  });
  const known = new Set(knownRoles.map((role) => role.key));
  const missingRoles = parsed.roleKeys.filter((key) => !known.has(key));
  if (missingRoles.length > 0) throw new ValidationError(apiCopy("apiCopy.unknown.roles.cf556dfb", { v0: String(missingRoles.join(", ")) }));
  const requestedNodeIds = Array.from(
    new Set(parsed.storageAccess.map((grant) => grant.storageNodeId).filter(Boolean)),
  );
  if (requestedNodeIds.length > 0) {
    const knownNodes = await prisma.storageNode.findMany({
      where: { id: { in: requestedNodeIds }, teamId },
      select: { id: true },
      take: requestedNodeIds.length,
    });
    const validNodes = new Set(knownNodes.map((n) => n.id));
    const invalidNode = parsed.storageAccess.find((grant) => !validNodes.has(grant.storageNodeId));
    if (invalidNode) throw new ValidationError(apiCopy("apiCopy.unknown.storage.node.f272cf95", { v0: String(invalidNode.storageNodeId) }));
  }
  const serverIds = parsed.serverAccess.map((grant) => grant.serverId);
  if (new Set(serverIds).size !== serverIds.length) {
    throw new ValidationError(t("backend.auth.duplicateServerAccess"));
  }
  if (serverIds.length > 0) {
    const knownServers = await prisma.server.findMany({
      where: { id: { in: serverIds }, teamId },
      select: { id: true },
      take: serverIds.length,
    });
    if (knownServers.length !== serverIds.length) {
      throw new ValidationError(t("backend.auth.unknownServerInTemplate"));
    }
  }
  return parsed;
}

const COMMON_TEMPLATES = [
  { id: "builtin:viewer", name: "只读观察员", description: "查看服务器、云盘和审计信息", roleKeys: ["viewer"] },
  { id: "builtin:operator", name: "日常运维", description: "服务器连接、执行任务和文件维护", roleKeys: ["operator"] },
  { id: "builtin:storage_manager", name: "云盘管理员", description: "管理云盘节点、文件与分享", roleKeys: ["storage_manager"] },
] as const;

export async function listRoleTemplates(teamId: string | null) {
  const rows = await prisma.roleTemplate.findMany({
    where: teamId
      ? { OR: [{ teamId }, { isBuiltin: true, teamId: null }] }
      : { isBuiltin: true, teamId: null },
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200,
  });
  return [
    ...COMMON_TEMPLATES.map((preset) => ({
      ...preset, description: preset.description, roleKeys: [...preset.roleKeys],
      permissions: [] as string[], storageAccess: [], serverAccess: [],
      isBuiltin: true, teamId: null, createdBy: null,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    })),
    ...rows.map(serialize),
  ];
}

export async function createRoleTemplate(input: unknown, createdBy: string, teamId: string) {
  const parsed = await validateInput(input, teamId);
  return serialize(await prisma.roleTemplate.create({
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      roleKeys: Array.from(new Set(parsed.roleKeys)),
      permissions: Array.from(new Set(parsed.permissions)),
      dataScope: { storageAccess: parsed.storageAccess, serverAccess: parsed.serverAccess } as Prisma.InputJsonValue,
      createdBy,
      teamId,
    },
  }));
}

export async function updateRoleTemplate(id: string, input: unknown, teamId: string) {
  const parsed = await validateInput(input, teamId);
  const template = await prisma.roleTemplate.findFirst({ where: { id, teamId }, select: { isBuiltin: true } });
  if (!template) {
    throw new NotFoundError(t("backend.auth.roleTemplateNotFound"));
  }
  if (template.isBuiltin) {
    throw new ValidationError(t("backend.auth.builtInTemplatesCannotBeModified"));
  }
  return serialize(await prisma.roleTemplate.update({
    where: { id, teamId },
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      roleKeys: Array.from(new Set(parsed.roleKeys)),
      permissions: Array.from(new Set(parsed.permissions)),
      dataScope: { storageAccess: parsed.storageAccess, serverAccess: parsed.serverAccess } as Prisma.InputJsonValue,
    },
  }));
}

export async function deleteRoleTemplate(id: string, teamId: string) {
  const template = await prisma.roleTemplate.findFirst({ where: { id, teamId }, select: { isBuiltin: true } });
  if (!template) {
    throw new NotFoundError(t("backend.auth.roleTemplateNotFound"));
  }
  if (template.isBuiltin) {
    throw new ValidationError(t("backend.auth.builtInTemplatesCannotBeDeleted"));
  }
  const assignedMembers = await prisma.teamMember.count({ where: { teamId, permissionTemplateId: id } });
  if (assignedMembers > 0) {
    throw new ValidationError(t("backend.auth.assignedGroupCannotBeDeleted"));
  }
  await prisma.roleTemplate.delete({ where: { id, teamId } });
}
