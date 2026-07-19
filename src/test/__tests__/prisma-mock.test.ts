import { describe, expect, it, vi } from "vitest";
import { mockPrismaFindFirstById, mockPrismaMethod } from "../prisma-mock";

describe("prisma-mock helpers", () => {
	it("mockPrismaFindFirstById returns hit for string id and miss otherwise", async () => {
		const findFirst = vi.fn();
		mockPrismaFindFirstById(findFirst, { id: "a" }, null);
		await expect(findFirst({ where: { id: "a" } })).resolves.toEqual({ id: "a" });
		await expect(findFirst({ where: { id: { not: "a" } } })).resolves.toBeNull();
	});

	it("mockPrismaMethod accepts async implementations under Prisma-like typing", async () => {
		const update = vi.fn();
		mockPrismaMethod(update, async () => ({ ok: true }));
		await expect(update({ where: { id: "1" } })).resolves.toEqual({ ok: true });
	});
});
