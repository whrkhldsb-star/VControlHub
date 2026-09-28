import { apiCopy } from "@/lib/i18n/api-copy";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS, getPermissionsFromRoles, type RoleKey } from "@/lib/auth/rbac";
import { WORKSPACE_POLICY_PERMISSIONS } from "@/lib/auth/tenant-permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

export const ROLE_TEMPLATE_KINDS = ["ACCOUNT_TEMPLATE", "POLICY_GROUP"] as const;
export type RoleTemplateKind = (typeof ROLE_TEMPLATE_KINDS)[number];

const GROUP_ROLE_KEYS = new Set(["viewer", "operator", "storage_manager"]);
const GROUP_PERMISSIONS = new Set<string>(WORKSPACE_POLICY_PERMISSIONS);
const MAX_SIGNED_BIGINT = BigInt("9223372036854775807");

function validNullableBigIntString(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") return true;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  try {
    return BigInt(trimmed) <= MAX_SIGNED_BIGINT;
  } catch {
    return false;
  }
}

export const roleTemplateStorageGrantSchema = z.object({
  storageNodeId: z.string().min(1),
  pathPrefix: z.string().max(500).default(""),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  quotaBytes: z.string().nullable().optional().refine(validNullableBigIntString),
  maxFileBytes: z.string().nullable().optional().refine(validNullableBigIntString),
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
  kind: z.enum(ROLE_TEMPLATE_KINDS).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1)).max(20).default([]),
  permissions: z.array(z.string().trim().min(1)).max(500).default([]),
  storageAccess: z.array(roleTemplateStorageGrantSchema).max(5000).default([]),
  serverAccess: z.array(roleTemplateServerGrantSchema).max(5000).default([]),
});

export type RoleTemplateInput = z.infer<typeof roleTemplateInputSchema>;

function serialize(row: {
  id: string;
  name: string;
  description: string | null;
  kind: string;
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
    kind: row.kind as RoleTemplateKind,
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

async function validateInput(input: unknown, teamId: string, expectedKind?: RoleTemplateKind) {
  const parsed = roleTemplateInputSchema.parse(input);
  const kind = expectedKind ?? parsed.kind ?? "ACCOUNT_TEMPLATE";
  if (expectedKind && parsed.kind && parsed.kind !== expectedKind) {
    throw new ValidationError(t("backend.auth.templateKindCannotChange"));
  }
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
  if (kind === "POLICY_GROUP") {
    const invalidGroupRoles = parsed.roleKeys.filter((key) => !GROUP_ROLE_KEYS.has(key));
    const invalidGroupPermissions = parsed.permissions.filter((key) => !GROUP_PERMISSIONS.has(key));
    if (invalidGroupRoles.length > 0 || invalidGroupPermissions.length > 0) {
      throw new ValidationError(t("backend.auth.invalidWorkspacePolicyGroup"));
    }
    if (parsed.storageAccess.length > 0 || parsed.serverAccess.length > 0) {
      throw new ValidationError(t("backend.auth.policyGroupCannotContainResourceSnapshots"));
    }
  }
  const normalizedStorageAccess = parsed.storageAccess.map((grant) => {
    // Keep the existing UI convenience that treats a leading slash as the
    // storage-root marker, while rejecting traversal and illegal segments.
    const rawPath = grant.pathPrefix.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalized = normalizeStorageTargetDirectory(rawPath);
    if (!normalized.ok) {
      throw new ValidationError(t("backend.user.invalidStoragePath"));
    }
    return { ...grant, pathPrefix: normalized.path };
  });
  const storageKeys = new Set<string>();
  for (const grant of normalizedStorageAccess) {
    const key = `${grant.storageNodeId}\0${grant.pathPrefix}`;
    if (storageKeys.has(key)) {
      throw new ValidationError(t("backend.user.duplicateStorageAccess"));
    }
    storageKeys.add(key);
  }
  const requestedNodeIds = Array.from(
    new Set(normalizedStorageAccess.map((grant) => grant.storageNodeId).filter(Boolean)),
  );
  if (requestedNodeIds.length > 0) {
    const knownNodes = await prisma.storageNode.findMany({
      where: { id: { in: requestedNodeIds }, teamId },
      select: { id: true },
      take: requestedNodeIds.length,
    });
    const validNodes = new Set(knownNodes.map((n) => n.id));
    const invalidNode = normalizedStorageAccess.find((grant) => !validNodes.has(grant.storageNodeId));
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
  return { ...parsed, storageAccess: normalizedStorageAccess, kind };
}

const COMMON_TEMPLATES = [
  { id: "builtin:viewer", name: "只读观察员", description: "查看服务器、云盘和审计信息", roleKeys: ["viewer"] },
  { id: "builtin:operator", name: "日常运维", description: "服务器连接、执行任务和文件维护", roleKeys: ["operator"] },
  { id: "builtin:storage_manager", name: "云盘管理员", description: "管理云盘节点、文件与分享", roleKeys: ["storage_manager"] },
] as const;

export const DEFAULT_WORKSPACE_POLICY_GROUPS = COMMON_TEMPLATES.map((template) => ({
  key: template.id.slice("builtin:".length),
  name: template.name,
  description: template.description,
  roleKeys: [] as string[],
  permissions: getPermissionsFromRoles([template.roleKeys[0] as RoleKey]).filter((permission) => GROUP_PERMISSIONS.has(permission)),
}));

export function defaultWorkspacePolicyGroupId(teamId: string, key: string) {
  return `policy:${teamId}:${key}`;
}

export async function listRoleTemplates(teamId: string | null, kind: RoleTemplateKind = "ACCOUNT_TEMPLATE") {
  const rows = await prisma.roleTemplate.findMany({
    where: kind === "POLICY_GROUP"
      ? { teamId: teamId ?? "__no_active_team__", kind }
      : teamId
        ? { kind, OR: [{ teamId }, { isBuiltin: true, teamId: null }] }
        : { kind, isBuiltin: true, teamId: null },
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200,
  });
  return [
    ...(kind === "ACCOUNT_TEMPLATE" ? COMMON_TEMPLATES.map((preset) => ({
      ...preset, description: preset.description, roleKeys: [...preset.roleKeys],
      permissions: [] as string[], storageAccess: [], serverAccess: [],
      kind: "ACCOUNT_TEMPLATE" as const,
      isBuiltin: true, teamId: null, createdBy: null,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    })) : []),
    ...rows.map(serialize),
  ];
}

export async function createRoleTemplate(
  input: unknown,
  createdBy: string,
  teamId: string,
  allowAccountTemplates = false,
) {
  const parsed = await validateInput(input, teamId);
  if (parsed.kind === "ACCOUNT_TEMPLATE" && !allowAccountTemplates) {
    throw new ForbiddenError(t("backend.auth.accountTemplatesRequirePlatformAdmin"));
  }
  const storedRoleKeys = parsed.kind === "POLICY_GROUP" ? [] : Array.from(new Set(parsed.roleKeys));
  const storedPermissions = parsed.kind === "POLICY_GROUP"
    ? Array.from(new Set([
        ...parsed.permissions,
        ...getPermissionsFromRoles(parsed.roleKeys as RoleKey[]).filter((permission) => GROUP_PERMISSIONS.has(permission)),
      ])).sort()
    : Array.from(new Set(parsed.permissions));
  return serialize(await prisma.roleTemplate.create({
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      kind: parsed.kind,
      roleKeys: storedRoleKeys,
      permissions: storedPermissions,
      dataScope: { storageAccess: parsed.storageAccess, serverAccess: parsed.serverAccess } as Prisma.InputJsonValue,
      createdBy,
      teamId,
    },
  }));
}

export async function updateRoleTemplate(
  id: string,
  input: unknown,
  teamId: string,
  allowAccountTemplates = false,
) {
  const template = await prisma.roleTemplate.findFirst({ where: { id, teamId }, select: { isBuiltin: true, kind: true } });
  if (!template) {
    throw new NotFoundError(t("backend.auth.roleTemplateNotFound"));
  }
  if (template.kind === "ACCOUNT_TEMPLATE" && !allowAccountTemplates) {
    throw new ForbiddenError(t("backend.auth.accountTemplatesRequirePlatformAdmin"));
  }
  if (template.isBuiltin) {
    throw new ValidationError(t("backend.auth.builtInTemplatesCannotBeModified"));
  }
  const parsed = await validateInput(input, teamId, template.kind as RoleTemplateKind);
  const storedRoleKeys = parsed.kind === "POLICY_GROUP" ? [] : Array.from(new Set(parsed.roleKeys));
  const storedPermissions = parsed.kind === "POLICY_GROUP"
    ? Array.from(new Set([
        ...parsed.permissions,
        ...getPermissionsFromRoles(parsed.roleKeys as RoleKey[]).filter((permission) => GROUP_PERMISSIONS.has(permission)),
      ])).sort()
    : Array.from(new Set(parsed.permissions));
  return serialize(await prisma.roleTemplate.update({
    where: { id, teamId },
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      roleKeys: storedRoleKeys,
      permissions: storedPermissions,
      dataScope: { storageAccess: parsed.storageAccess, serverAccess: parsed.serverAccess } as Prisma.InputJsonValue,
    },
  }));
}

export async function deleteRoleTemplate(id: string, teamId: string, allowAccountTemplates = false) {
  const template = await prisma.roleTemplate.findFirst({ where: { id, teamId }, select: { isBuiltin: true, kind: true } });
  if (!template) {
    throw new NotFoundError(t("backend.auth.roleTemplateNotFound"));
  }
  if (template.kind === "ACCOUNT_TEMPLATE" && !allowAccountTemplates) {
    throw new ForbiddenError(t("backend.auth.accountTemplatesRequirePlatformAdmin"));
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
