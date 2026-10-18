import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	peekShareToken: vi.fn(),
	listShareDirectoryFiles: vi.fn(),
	verifyShareDownloadTicket: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })),
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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: vi.fn(async () => ({ allowed: true })) }));
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

	it("keeps it behind the password gate without one", async () => {
		mocks.verifyShareDownloadTicket.mockReturnValue(null);
		mocks.peekShareToken.mockResolvedValue({ id: "share-1", entryType: "DIRECTORY", name: "photos", permissionLevel: "download", expiresAt: null, hasPassword: true, locked: true });

		render(await SharePage({ params: Promise.resolve({ token: "tok" }) }));

		expect(screen.getByTestId("password-gate")).toBeInTheDocument();
		expect(mocks.listShareDirectoryFiles).not.toHaveBeenCalled();
		expect(screen.queryByText("a.jpg")).toBeNull();
	});
});
