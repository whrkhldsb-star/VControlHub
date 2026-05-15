import { beforeEach, describe, expect, it, vi } from "vitest";

const { canUseSshTerminal } = await import("../ssh-access");

describe("SSH server access control", () => {
	beforeEach(() => vi.clearAllMocks());

	it("requires server:ssh permission for terminal use", () => {
		expect(canUseSshTerminal({ roles: ["viewer"] })).toBe(false);
		expect(canUseSshTerminal({ roles: ["storage_manager"] })).toBe(false);
		expect(canUseSshTerminal({ roles: ["operator"] })).toBe(true);
		expect(canUseSshTerminal({ roles: ["admin"] })).toBe(true);
	});
});
