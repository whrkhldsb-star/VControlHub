/**
 * TR-030 / 56 multi-tenant (Tick 3): page-level second-line guard.
 *
 * Verifies that `/ai-ops` page delegates its read-permission check to
 * `requirePagePermission("ai:ops:read")` so a forbidden request bubbles up
 * as a `ForbiddenError` (which the root `error.tsx` translates into
 * `<PermissionDenied />`) instead of silently rendering an empty state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

const requirePagePermissionMock = vi.fn();
const listAiOpsLogsMock = vi.fn();
const summariseAiOpsMock = vi.fn();
const getSettingMock = vi.fn();

vi.mock("@/lib/auth/page-guard", () => ({
	requirePagePermission: requirePagePermissionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({
	requireSession: vi.fn(),
}));
vi.mock("@/lib/ai/ops/service", () => ({
	listAiOpsLogs: listAiOpsLogsMock,
	summariseAiOps: summariseAiOpsMock,
}));
vi.mock("@/lib/settings/service", () => ({
	getSetting: getSettingMock,
}));
// The RSC reads the locale cookie via `next/headers` which is not
// available outside a request scope (unit test env). Mock it with a
// deterministic value so the assertion can focus on the permission gate.
vi.mock("@/lib/i18n/translations", async () => {
	const actual = await vi.importActual<typeof import("@/lib/i18n/translations")>(
		"@/lib/i18n/translations",
	);
	return {
		...actual,
		getServerLocale: async () => "zh" as const,
	};
});

describe("/ai-ops page permission gate", () => {
	beforeEach(() => {
		// P-NEW: mocks retain call state across tests within the same file.
		// Without this, the second test inherits `summariseAiOpsMock.mock.calls`
		// from the first test and `not.toHaveBeenCalled()` spuriously fails.
		requirePagePermissionMock.mockReset();
		listAiOpsLogsMock.mockReset();
		summariseAiOpsMock.mockReset();
		getSettingMock.mockReset();
	});

	it("calls requirePagePermission with the read permission before rendering", async () => {
		requirePagePermissionMock.mockResolvedValue({
			userId: "u1",
			roles: ["admin"],
		});
		summariseAiOpsMock.mockResolvedValue({
			total: 0,
			byStatus: {
				ok: 0,
				error: 0,
				warning: 0,
				skipped: 0,
				running: 0,
			},
			byMode: { recommendation: 0, autonomous: 0 },
			lastScanAt: null,
			lastErrorAt: null,
		});
		listAiOpsLogsMock.mockResolvedValue([]);
		getSettingMock.mockResolvedValue("recommendation");

		const { default: AiOpsPage } = await import("../page");
		await AiOpsPage();

		expect(requirePagePermissionMock).toHaveBeenCalledTimes(1);
		expect(requirePagePermissionMock).toHaveBeenCalledWith("ai:ops:read");
	});

	it("lets ForbiddenError bubble up (no manual PermissionDenied render)", async () => {
		requirePagePermissionMock.mockRejectedValue(
			new ForbiddenError("缺少权限：ai:ops:read", { permission: "ai:ops:read" }),
		);

		const { default: AiOpsPage } = await import("../page");
		await expect(AiOpsPage()).rejects.toBeInstanceOf(ForbiddenError);

		// Downstream services must NOT be called when permission is denied.
		expect(summariseAiOpsMock).not.toHaveBeenCalled();
		expect(listAiOpsLogsMock).not.toHaveBeenCalled();
		expect(getSettingMock).not.toHaveBeenCalled();
	});
});
