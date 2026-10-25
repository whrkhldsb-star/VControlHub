import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	peekShareToken: vi.fn(),
	listShareDirectoryFiles: vi.fn(),
	verifyShareDownloadTicket: vi.fn(),
	checkRateLimitAsync: vi.fn(async () => ({ allowed: true })),
	requestHeaders: { "x-forwarded-for": "203.0.113.9" } as Record<string, string>,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers(mocks.requestHeaders)),
	cookies: vi.fn(async () => ({ get: () => ({ value: "ticket" }) })),
}));
vi.mock("@/lib/share-link/service", () => ({
	peekShareToken: mocks.peekShareToken,
	listShareDirectoryFiles: mocks.listShareDirectoryFiles,
	hashShareToken: (token: string) => `hash:${token}`,
}));
vi.mock("@/lib/share-link/download-ticket", () => ({
	getShareDownloadTicketCookieName: () => "share_ticket",
	verifyShareDownloadTicket: mocks.verifyShareDownloadTicket,
}));
// The real client-IP rule (TRUSTED_PROXY_HOPS, default 1); only the store is stubbed.
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/rate-limit")>()),
	checkRateLimitAsync: mocks.checkRateLimitAsync,
}));
vi.mock("@/lib/i18n/translations", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/i18n/translations")>()),
	getServerLocale: async () => "zh",
}));
vi.mock("../share-password-gate", () => ({ SharePasswordGate: () => <div data-testid="password-gate" /> }));

const { default: SharePage } = await import("../page");

const directoryShare = {
	id: "share-1",
	entryType: "DIRECTORY",
	name: "photos",
	path: "team/photos",
	storageNodeId: "node-1",
	storageNode: { name: "node", basePath: "/srv", driver: "LOCAL" },
	permissionLevel: "download",
	expiresAt: null,
	hasPassword: true,
};

describe("share page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requestHeaders = { "x-forwarded-for": "203.0.113.9" };
		mocks.listShareDirectoryFiles.mockResolvedValue([
			{ id: "f-1", name: "a.jpg", relativePath: "team/photos/a.jpg", size: BigInt(10), mimeType: "image/jpeg", updatedAt: new Date("2026-10-18T00:00:00Z") },
		]);
	});

	it("opens a password-protected folder once the visitor holds a valid ticket", async () => {
		mocks.verifyShareDownloadTicket.mockReturnValue("share-1");
		mocks.peekShareToken.mockResolvedValue({ ...directoryShare, locked: false });

		render(await SharePage({ params: Promise.resolve({ token: "tok" }) }));

		expect(mocks.peekShareToken).toHaveBeenCalledWith("tok", expect.objectContaining({ authorizedShareId: "share-1" }));
		expect(screen.queryByTestId("password-gate")).toBeNull();
		expect(screen.getByText("a.jpg")).toBeInTheDocument();
	});

	it("counts and logs a visitor by the address the proxy saw, not the one the visitor wrote", async () => {
		// The first X-Forwarded-For entry is whatever the client sent: a new
		// value per request slipped past the per-IP limit and forged the log.
		mocks.requestHeaders = { "x-forwarded-for": "198.51.100.77, 203.0.113.9" };
		mocks.verifyShareDownloadTicket.mockReturnValue("share-1");
		mocks.peekShareToken.mockResolvedValue({ ...directoryShare, locked: false });

		render(await SharePage({ params: Promise.resolve({ token: "tok" }) }));

		expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith("share-page:203.0.113.9", expect.anything());
		expect(mocks.peekShareToken).toHaveBeenCalledWith("tok", expect.objectContaining({ ip: "203.0.113.9" }));
	});

	it("keeps it behind the password gate without one", async () => {
		mocks.verifyShareDownloadTicket.mockReturnValue(null);
		mocks.peekShareToken.mockResolvedValue({ id: "share-1", entryType: "DIRECTORY", name: "photos", permissionLevel: "download", expiresAt: null, hasPassword: true, locked: true });

		render(await SharePage({ params: Promise.resolve({ token: "tok" }) }));

		expect(screen.getByTestId("password-gate")).toBeInTheDocument();
		expect(mocks.listShareDirectoryFiles).not.toHaveBeenCalled();
		expect(screen.queryByText("a.jpg")).toBeNull();
	});
});
