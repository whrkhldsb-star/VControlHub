import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileMoreActions } from "../file-more-actions";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const entry = {
	id: "file_1",
	name: "report.pdf",
	entryType: "FILE",
	relativePath: "docs/report.pdf",
	sizeLabel: "1 MB",
	previewable: true,
	directAccess: { mode: "PROXY", description: "通过控制台下载" },
	storageNode: { id: "node_1", name: "Local", driver: "LOCAL" },
} as any;

const alwaysTrue = () => true;

describe("FileMoreActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(navigator, {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		});
	});

	it("keeps the menu mounted while a portalled confirmation dialog is used, so quick share still fires", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ token: "share-token" });

		render(
			<FileMoreActions
				entry={entry}
				canShare
				canDelete={false}
				entryCanRead={alwaysTrue}
				entryCanWrite={() => false}
				entryCanDelete={() => false}
			/>,
		);

		await user.click(screen.getByRole("button", { name: /更多操作 report\.pdf/ }));
		const menu = await screen.findByRole("group", { name: /更多操作 report\.pdf/ });

		await user.click(await screen.findByRole("button", { name: "分享" }));
		expect(
			screen.getByRole("heading", { name: "创建临时公开分享？" }),
		).toBeInTheDocument();
		// The dialog lives in its own body portal — the menu's outside-click
		// handler must not treat it as an outside click.
		expect(menu).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "创建临时链接" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/share-links", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fileEntryId: "file_1", quick: true }),
			});
		});
		// The generated link is rendered inside the menu, so the menu must
		// survive the whole interaction.
		expect(await screen.findByText("http://localhost:3000/share/share-token")).toBeInTheDocument();
	});
});
