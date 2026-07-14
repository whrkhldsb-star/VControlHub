import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/auth/rbac";
import { ValidationError } from "@/lib/errors";

export const roleTemplateStorageGrantSchema = z.object({
  storageNodeId: z.string().min(1),
  pathPrefix: z.string().max(500).default(""),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  quotaBytes: z.string().nullable().optional(),
  maxFileBytes: z.string().nullable().optional(),
});

export const roleTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  roleKeys: z.array(z.string().trim().min(1)).max(20).default([]),
  permissions: z.array(z.string().trim().min(1)).max(500).default([]),
  storageAccess: z.array(roleTemplateStorageGrantSchema).max(100).default([]),
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
  createdAt: Date;
  updatedAt: Date;
}) {
  const scope = row.dataScope && typeof row.dataScope === "object" && !Array.isArray(row.dataScope)
    ? row.dataScope as Record<string, unknown>
    : {};
  const storageAccess = Array.isArray(scope.storageAccess) ? scope.storageAccess : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roleKeys: row.roleKeys,
    permissions: row.permissions,
    storageAccess,
    isBuiltin: row.isBuiltin,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateInput(input: unknown) {
  const parsed = roleTemplateInputSchema.parse(input);
  const validPermissionSet = new Set<string>(ALL_PERMISSIONS);
  const invalidPermissions = parsed.permissions.filter((key) => !validPermissionSet.has(key));
  if (invalidPermissions.length > 0) {
    throw new ValidationError(`Unknown permissions: ${invalidPermissions.join(", ")}`);
  }
  const knownRoles = await prisma.role.findMany({
    where: { key: { in: parsed.roleKeys } },
    select: { key: true },
    take: parsed.roleKeys.length || 1,
  });
  const known = new Set(knownRoles.map((role) => role.key));
  const missingRoles = parsed.roleKeys.filter((key) => !known.has(key));
  if (missingRoles.length > 0) throw new ValidationError(`Unknown roles: ${missingRoles.join(", ")}`);
  const validNodes = new Set((await prisma.storageNode.findMany({ select: { id: true }, take: 500 })).map((n) => n.id));
  const invalidNode = parsed.storageAccess.find((grant) => !validNodes.has(grant.storageNodeId));
  if (invalidNode) throw new ValidationError(`Unknown storage node: ${invalidNode.storageNodeId}`);
  return parsed;
}

export async function listRoleTemplates() {
  const rows = await prisma.roleTemplate.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200 });
  return rows.map(serialize);
}

export async function createRoleTemplate(input: unknown, createdBy: string) {
  const parsed = await validateInput(input);
  return serialize(await prisma.roleTemplate.create({
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      roleKeys: Array.from(new Set(parsed.roleKeys)),
      permissions: Array.from(new Set(parsed.permissions)),
      dataScope: { storageAccess: parsed.storageAccess } as Prisma.InputJsonValue,
      createdBy,
    },
  }));
}

export async function updateRoleTemplate(id: string, input: unknown) {
  const parsed = await validateInput(input);
  return serialize(await prisma.roleTemplate.update({
    where: { id },
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      roleKeys: Array.from(new Set(parsed.roleKeys)),
      permissions: Array.from(new Set(parsed.permissions)),
      dataScope: { storageAccess: parsed.storageAccess } as Prisma.InputJsonValue,
    },
  }));
}

export async function deleteRoleTemplate(id: string) {
  const template = await prisma.roleTemplate.findUnique({ where: { id }, select: { isBuiltin: true } });
  if (template?.isBuiltin) throw new ValidationError("Built-in templates cannot be deleted");
  await prisma.roleTemplate.delete({ where: { id } });
}
