import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareFilePicker } from "../share-file-picker";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: vi.fn(() => ({ locale: "zh" })),
}));

const mockedFetch = vi.mocked(csrfFetch);
const mockedUseI18n = vi.mocked(useI18n);

describe("ShareFilePicker", () => {
	it("browses files in share center and creates links for selected folders and files", async () => {
		const user = userEvent.setup();
		mockedFetch
			.mockResolvedValueOnce({
				currentPath: "",
				nodeIdFilter: "node_1",
				folders: [{ name: "photos", relativePath: "photos", storageNodeId: "node_1" }],
				files: [{ id: "file_1", name: "readme.txt", entryType: "FILE", relativePath: "readme.txt", sizeLabel: "1 KB", storageNodeId: "node_1", storageNodeName: "主存储" }],
				nodes: [{ id: "node_1", name: "主存储", driver: "LOCAL" }],
			})
			.mockResolvedValueOnce({ token: "folder-token" })
			.mockResolvedValueOnce({ token: "file-token" });

		render(<ShareFilePicker nodes={[{ id: "node_1", name: "主存储", driver: "LOCAL" }]} />);

		expect(await screen.findByRole("heading", { name: "在分享中心选择文件" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /文件管理/ })).not.toBeInTheDocument();

		await user.click(await screen.findByLabelText("选择文件夹 photos"));
		await user.click(screen.getByLabelText("选择文件 readme.txt"));
		await user.click(screen.getByRole("button", { name: "创建分享链接" }));

		await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith("/api/share-links", expect.objectContaining({ method: "POST" })));
		expect(JSON.parse(String(mockedFetch.mock.calls[1]?.[1]?.body))).toMatchObject({ storageNodeId: "node_1", path: "photos", entryType: "DIRECTORY", name: "photos" });
		expect(JSON.parse(String(mockedFetch.mock.calls[2]?.[1]?.body))).toMatchObject({ storageNodeId: "node_1", path: "readme.txt", entryType: "FILE", name: "readme.txt" });
		expect(refresh).toHaveBeenCalled();

		const results = await screen.findByText("已创建，可直接复制：");
		const panel = results.closest("div");
		expect(panel).not.toBeNull();
		expect(within(panel as HTMLElement).getByText(/folder-token/)).toBeInTheDocument();
		expect(within(panel as HTMLElement).getByText(/file-token/)).toBeInTheDocument();
	});

	it("renders English copy without mutating storage node names", async () => {
		mockedUseI18n.mockReturnValue({ locale: "en" } as ReturnType<typeof useI18n>);
		mockedFetch.mockResolvedValueOnce({
			currentPath: "",
			nodeIdFilter: "node_1",
			folders: [],
			files: [],
			nodes: [{ id: "node_1", name: "本机默认存储", driver: "LOCAL" }],
		});

		render(<ShareFilePicker nodes={[{ id: "node_1", name: "本机默认存储", driver: "LOCAL" }]} />);

		expect(await screen.findByRole("heading", { name: "Choose files in Shares" })).toBeInTheDocument();
		expect(screen.getByText("本机默认存储 · LOCAL")).toBeInTheDocument();
		expect(screen.getByText("No shareable items in this folder")).toBeInTheDocument();
		expect(screen.getByText("Selected 0 items")).toBeInTheDocument();
		expect(screen.getByText("Select files or folders on the left")).toBeInTheDocument();
	});
});
