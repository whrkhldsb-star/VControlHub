import { beforeEach, describe, expect, it, vi } from "vitest";

const { canUseSshTerminal } = await import("../ssh-access");

describe("SSH server access control", () => {
	beforeEach(() => vi.clearAllMocks());

	it("requires server:ssh permission for terminal use", () => {
		expect(canUseSshTerminal({ roles: ["viewer"], mustChangePassword: false })).toBe(false);
		expect(canUseSshTerminal({ roles: ["storage_manager"], mustChangePassword: false })).toBe(false);
		expect(canUseSshTerminal({ roles: ["operator"], mustChangePassword: false })).toBe(true);
		expect(canUseSshTerminal({ roles: ["admin"], mustChangePassword: false })).toBe(true);
		expect(canUseSshTerminal({ roles: ["admin"], mustChangePassword: true })).toBe(false);
	});
});
