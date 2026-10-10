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
		expect(prismaMock.identityTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl" } });
	});
});
