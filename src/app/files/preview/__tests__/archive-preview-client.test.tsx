import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the archive preview panel.
 *
 * Extraction writes files into the storage node, so the properties that matter
 * are that the request carries the node/path/driver it was given (never a value
 * derived on the client), that a server-side `{ error }` on a 200 is treated as a
 * failure rather than reported as success, and that listing failures surface
 * instead of rendering as an empty archive.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
const i18n = {
	t: (key: string, vars?: Record<string, string | number>) =>
		vars ? `${key}:${Object.values(vars).join(",")}` : key,
	locale: "zh" as const,
	setLocale: () => {},
};
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => i18n }));

import { ArchivePreviewClient } from "../archive-preview-client";

const props = {
	name: "bundle.tar.gz",
	nodeId: "node_1",
	relativePath: "backups/bundle.tar.gz",
	driver: "LOCAL",
};

function renderPanel() {
	return render(<ArchivePreviewClient {...props} />);
}

/** The list button is always present; the extract button appears once entries load. */
function clickList() {
	fireEvent.click(screen.getByRole("button", { name: /archivePreview\.(title|refreshList|loading)/ }));
}

async function clickExtract() {
	fireEvent.click(
		await screen.findByRole("button", { name: /archivePreview\.(extract|extracting)/ }),
	);
}

describe("ArchivePreviewClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({ entries: [{ name: "a.txt", size: 12 }] });
	});

	it("passes the node, path and driver it was given when listing", async () => {
		renderPanel();
		clickList();
		await waitFor(() => {
			const list = mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("/api/files/archive-list"));
			expect(list).toBeTruthy();
			const url = new URL(String(list![0]), "https://a.test");
			expect(url.searchParams.get("nodeId")).toBe("node_1");
			expect(url.searchParams.get("relativePath")).toBe("backups/bundle.tar.gz");
			expect(url.searchParams.get("driver")).toBe("LOCAL");
		});
	});

	it("encodes a path with spaces and slashes through URLSearchParams", async () => {
		render(<ArchivePreviewClient {...props} relativePath="my backups/a&b.tar.gz" />);
		clickList();
		await waitFor(() => {
			const list = mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("/api/files/archive-list"));
			const url = new URL(String(list![0]), "https://a.test");
			// The `&` must stay part of the value rather than starting a new param.
			expect(url.searchParams.get("relativePath")).toBe("my backups/a&b.tar.gz");
		});
	});

	it("surfaces a listing failure instead of rendering an empty archive", async () => {
		mocks.csrfFetch.mockRejectedValue(new Error("not a valid gzip stream"));
		renderPanel();
		clickList();
		await waitFor(() =>
			expect(screen.getByText(/not a valid gzip stream/)).toBeInTheDocument(),
		);
	});

	it("treats an { error } payload on a 200 as an extraction failure", async () => {
		// The extract endpoint answers 200 with an error field in some paths;
		// reporting that as success would tell the user files were written.
		mocks.csrfFetch.mockImplementation(async (url: string) =>
			String(url).includes("/api/files/extract")
				? { error: "target directory is not writable" }
				: { entries: [{ name: "a.txt", size: 12 }] },
		);
		renderPanel();
		clickList();
		await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalled());
		await clickExtract();
		await waitFor(() =>
			expect(screen.getByText(/target directory is not writable/)).toBeInTheDocument(),
		);
	});

	it("sends the same node/path/driver on extract as on list", async () => {
		mocks.csrfFetch.mockImplementation(async (url: string) =>
			String(url).includes("/api/files/extract")
				? { message: "done" }
				: { entries: [{ name: "a.txt", size: 12 }] },
		);
		renderPanel();
		clickList();
		await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalled());
		await clickExtract();
		await waitFor(() => {
			const post = mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("/api/files/extract"));
			expect(post).toBeTruthy();
			expect(JSON.parse(post![1].body as string)).toEqual({
				nodeId: "node_1",
				relativePath: "backups/bundle.tar.gz",
				driver: "LOCAL",
				name: "bundle.tar.gz",
			});
		});
	});
});
