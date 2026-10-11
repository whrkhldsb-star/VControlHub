/**
 * Identity templates: platform-defined permission sets for customer accounts.
 * Built-in templates are read-only and kept in sync with the definitions in
 * `identity-templates.ts`; custom ones are created by platform administrators.
 */
import { z } from "zod";

import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { BUILTIN_IDENTITY_TEMPLATES, normalizeIdentityPermissions } from "./identity-templates";

export const identityTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string()).max(200),
});

export type IdentityTemplateInput = z.infer<typeof identityTemplateInputSchema>;

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  isBuiltin: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

/** Stored names of the built-ins; the interface shows them translated. */
const BUILTIN_TEMPLATE_LABELS: Record<string, { name: string; description: string }> = {
  "identity:customer_admin": { name: "客户管理员", description: "管理本客户的全部资源" },
  "identity:operator": { name: "客户运维", description: "连接服务器、执行任务和维护文件" },
  "identity:viewer": { name: "客户只读", description: "查看服务器、文件和审计信息" },
  "identity:files": { name: "仅文件", description: "管理本客户的存储、文件与分享" },
};

/**
 * Create missing built-in rows and rewrite their permissions so code changes
 * take effect. Runs with every seed: databases built with `prisma db push`
 * never ran the migration that first inserted them.
 */
export async function syncBuiltinIdentityTemplates() {
  for (const template of BUILTIN_IDENTITY_TEMPLATES) {
    const label = BUILTIN_TEMPLATE_LABELS[template.id] ?? { name: template.key, description: "" };
    await prisma.identityTemplate.upsert({
      where: { id: template.id },
      create: { id: template.id, ...label, permissions: [...template.permissions], isBuiltin: true },
      update: { permissions: [...template.permissions], isBuiltin: true },
    });
  }
}

export async function listIdentityTemplates() {
  return prisma.identityTemplate.findMany({
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    take: 200,
    select: TEMPLATE_SELECT,
  });
}

function templateData(input: IdentityTemplateInput) {
  const permissions = normalizeIdentityPermissions(input.permissions);
  if (permissions.length === 0) throw new ValidationError(t("backend.customer.templateNeedsPermissions"));
  return { name: input.name, description: input.description || null, permissions };
}

export async function createIdentityTemplate(input: IdentityTemplateInput, createdBy: string) {
  return prisma.identityTemplate.create({ data: { ...templateData(input), createdBy }, select: TEMPLATE_SELECT });
}

async function findEditable(id: string) {
  const template = await prisma.identityTemplate.findUnique({ where: { id }, select: { id: true, isBuiltin: true } });
  if (!template) throw new NotFoundError(t("backend.customer.templateNotFound"));
  if (template.isBuiltin) throw new ValidationError(t("backend.customer.builtinTemplateReadOnly"));
  return template;
}

export async function updateIdentityTemplate(id: string, input: IdentityTemplateInput) {
  await findEditable(id);
  return prisma.identityTemplate.update({ where: { id }, data: templateData(input), select: TEMPLATE_SELECT });
}

export async function deleteIdentityTemplate(id: string) {
  await findEditable(id);
  const inUse = await prisma.teamMember.count({ where: { identityTemplateId: id } });
  if (inUse > 0) throw new ConflictError(t("backend.customer.templateInUse", { count: inUse }));
  await prisma.identityTemplate.delete({ where: { id } });
}
