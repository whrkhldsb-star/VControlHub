import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/lib/errors";

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		identityTemplate: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
		teamMember: { count: vi.fn() },
	},
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const service = await import("../identity-template-service");

describe("identity template service", () => {
	beforeEach(() => vi.resetAllMocks());

	it("keeps built-in rows in sync with the code definitions", async () => {
		await service.syncBuiltinIdentityTemplates();
		expect(prismaMock.identityTemplate.upsert).toHaveBeenCalledTimes(4);
		expect(prismaMock.identityTemplate.upsert).toHaveBeenCalledWith({
			where: { id: "identity:customer_admin" },
			create: expect.objectContaining({ id: "identity:customer_admin", name: "客户管理员", isBuiltin: true }),
			update: { permissions: expect.arrayContaining(["server:write", "command:approve"]), isBuiltin: true },
		});
	});

	it("stores only customer permissions and refuses an empty template", async () => {
		prismaMock.identityTemplate.create.mockResolvedValue({ id: "tpl" });
		await service.createIdentityTemplate({ name: "夜班", permissions: ["server:read", "user:manage"] }, "admin");
		expect(prismaMock.identityTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ permissions: ["server:read"], createdBy: "admin" }),
		}));
		await expect(service.createIdentityTemplate({ name: "空", permissions: ["user:manage"] }, "admin")).rejects.toBeInstanceOf(ValidationError);
	});

	it("refuses to edit or delete a built-in template", async () => {
		prismaMock.identityTemplate.findUnique.mockResolvedValue({ id: "identity:viewer", isBuiltin: true });
		await expect(service.updateIdentityTemplate("identity:viewer", { name: "x", permissions: ["server:read"] })).rejects.toBeInstanceOf(ValidationError);
		await expect(service.deleteIdentityTemplate("identity:viewer")).rejects.toBeInstanceOf(ValidationError);
	});

	it("refuses to delete a template that accounts still use", async () => {
		prismaMock.identityTemplate.findUnique.mockResolvedValue({ id: "tpl", isBuiltin: false });
		prismaMock.teamMember.count.mockResolvedValue(2);
		await expect(service.deleteIdentityTemplate("tpl")).rejects.toBeInstanceOf(ConflictError);
		expect(prismaMock.identityTemplate.delete).not.toHaveBeenCalled();

		prismaMock.teamMember.count.mockResolvedValue(0);
		await service.deleteIdentityTemplate("tpl");
		expect(prismaMock.identityTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl", isBuiltin: false } });
	});
});

it.each([["P2003", 409], ["P2025", 404]])("maps a concurrent template delete error %s to HTTP %i", async (code, status) => {
	prismaMock.identityTemplate.findUnique.mockResolvedValue({ id: "tpl", isBuiltin: false });
	prismaMock.teamMember.count.mockResolvedValueOnce(0).mockResolvedValue(1);
	prismaMock.identityTemplate.delete.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("concurrent write", { code: String(code), clientVersion: "test" }));
	await expect(service.deleteIdentityTemplate("tpl")).rejects.toMatchObject({ status });
});

it("lists every legacy picker option and supports bounded template searches and exact ids", async () => {
	const rows = Array.from({ length: 201 }, (_, i) => ({ id: String(i), name: "ops", isBuiltin: false }));
	prismaMock.identityTemplate.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.slice(200));
	expect(await service.listIdentityTemplates()).toHaveLength(201);
	expect(prismaMock.identityTemplate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { OR: [{ isBuiltin: false, OR: [{ name: { gt: "ops" } }, { name: "ops", id: { gt: "199" } }] }] } }));
	prismaMock.identityTemplate.findMany.mockResolvedValue(rows.slice(0, 2));
	expect((await service.identityTemplateOptions({ pageSize: 1, search: "ops" })).nextCursor).toMatch(/^v1\./);
	expect(prismaMock.identityTemplate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { name: { contains: "ops", mode: "insensitive" } } }));
	await service.identityTemplateOptions({ pageSize: 1, id: "assigned" });
	expect(prismaMock.identityTemplate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "assigned" } }));
});

it("maps removal during a template update to not found", async () => {
	prismaMock.identityTemplate.findUnique.mockResolvedValueOnce({ id: "tpl", isBuiltin: false });
	prismaMock.identityTemplate.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("removed", { code: "P2025", clientVersion: "test" }));
	await expect(service.updateIdentityTemplate("tpl", { name: "test", permissions: ["server:read"] })).rejects.toMatchObject({ status: 404 });
});
