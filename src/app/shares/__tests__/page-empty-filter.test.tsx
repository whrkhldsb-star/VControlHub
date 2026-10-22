import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/translations", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/i18n/translations")>()),
	getServerLocale: async () => "en",
}));
vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: vi.fn(async () => ({ userId: "u1", roles: ["admin"], currentTeamId: "t1" })) }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
vi.mock("@/lib/share-link/service", () => ({
	SHARE_LINK_STATUS_FILTERS: ["active", "expired", "revoked"],
	listShareLinkPage: vi.fn(async () => ({ shares: [], total: 0, page: 1, pageSize: 20 })),
}));
vi.mock("@/lib/storage/service", () => ({ listStorageNodes: vi.fn(async () => []) }));
vi.mock("../create-share-form", () => ({ CreateShareForm: () => null }));
vi.mock("../share-access-report", () => ({ ShareAccessReport: () => null }));
vi.mock("@/components/page-header-icon", () => ({ PageHeaderIcon: () => null }));

import SharesPage from "../page";

/**
 * A search with no result replaced the whole list body with the empty state,
 * search box and status filter included: they could only be changed by going
 * back or editing the address.
 */
describe("shares page with no matching shares", () => {
	it("keeps the search and status filter next to the empty state", async () => {
		render(await SharesPage({ searchParams: Promise.resolve({ q: "nothing-matches", status: "revoked" }) }));
		expect(screen.getByRole("searchbox")).toHaveValue("nothing-matches");
		expect(screen.getByRole("combobox")).toHaveValue("revoked");
	});
});
