import { prisma } from "@/lib/db";

/** A working import target has a platform administrator outside any customer. */
export async function createImportAdmin(id: string) {
  const role = await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { key: "admin", name: "admin" } });
  return prisma.user.create({ data: {
    id, username: id, status: "ACTIVE", passwordHash: "integration-fixture", mustChangePassword: false,
    roles: { create: { roleId: role.id } },
  } });
}
