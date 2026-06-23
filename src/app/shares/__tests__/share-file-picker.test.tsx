import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareFilePicker } from "../share-file-picker";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/i18n/use-locale", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@/lib/i18n/use-locale")>();
	const translations = await import("@/lib/i18n/translations");
	let currentLocale: "zh" | "en" = "zh";
	const buildT = () => (key: string) => translations.t(key, currentLocale);
	const useI18nMock = vi.fn(() => ({
		locale: currentLocale,
		t: buildT(),
		setLocale: vi.fn(),
	}));
	(globalThis as { __setI18nLocale?: (l: "zh" | "en") => void }).__setI18nLocale = (l) => {
		currentLocale = l;
	};
	return {
		...mod,
		useI18n: useI18nMock,
	};
});

const mockedFetch = vi.mocked(csrfFetch);
const _mockedUseI18n = vi.mocked(useI18n);
const setI18nLocale = (locale: "zh" | "en") => {
	(globalThis as { __setI18nLocale?: (l: "zh" | "en") => void }).__setI18nLocale?.(locale);
};

describe("ShareFilePicker", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockedFetch.mockReset();
		refresh.mockReset();
		// Reset i18n to default Chinese after a test that flipped to English
		setI18nLocale("zh");
	});
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
		setI18nLocale("en");
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

	describe("touch targets (TR-022 R19.B mobile)", () => {
		function mockHeightsBySelector(measurements: Record<string, number>) {
			// jsdom reports getBoundingClientRect as 0x0; install a minimal stub
			// that returns the requested height for buttons whose className includes
			// the test selector. Sufficient for asserting that min-h-11 produced
			// at least 44px of computed height. Same pattern as R17/R18/R19.A.
			const original = Element.prototype.getBoundingClientRect;
			Element.prototype.getBoundingClientRect = function () {
				const className = (this.getAttribute("class") ?? "") as string;
				for (const [selector, height] of Object.entries(measurements)) {
					if (className.includes(selector)) {
						return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 100, height, toJSON: () => ({}) } as DOMRect;
					}
				}
				return original.call(this);
			};
			return () => {
				Element.prototype.getBoundingClientRect = original;
			};
		}

		it("renders the refresh current folder button with at least 44px height", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				mockedFetch.mockResolvedValueOnce({
					currentPath: "",
					nodeIdFilter: "node_1",
					folders: [],
					files: [],
					nodes: [{ id: "node_1", name: "主存储", driver: "LOCAL" }],
				});
				render(<ShareFilePicker nodes={[{ id: "node_1", name: "主存储", driver: "LOCAL" }]} />);
				const btn = await screen.findByRole("button", { name: "刷新当前目录" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the create share links primary button with at least 44px height", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				mockedFetch.mockResolvedValueOnce({
					currentPath: "",
					nodeIdFilter: "node_1",
					folders: [],
					files: [],
					nodes: [{ id: "node_1", name: "主存储", driver: "LOCAL" }],
				});
				render(<ShareFilePicker nodes={[{ id: "node_1", name: "主存储", driver: "LOCAL" }]} />);
				const btn = await screen.findByRole("button", { name: "创建分享链接" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the clear text-only button with at least 44px height/width", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				mockedFetch.mockResolvedValueOnce({
					currentPath: "",
					nodeIdFilter: "node_1",
					folders: [],
					files: [],
					nodes: [{ id: "node_1", name: "主存储", driver: "LOCAL" }],
				});
				render(<ShareFilePicker nodes={[{ id: "node_1", name: "主存储", driver: "LOCAL" }]} />);
				const btn = await screen.findByRole("button", { name: "清空" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(btn.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the root breadcrumb text-only button with at least 44px height/width", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				mockedFetch.mockResolvedValueOnce({
					currentPath: "",
					nodeIdFilter: "node_1",
					folders: [],
					files: [],
					nodes: [{ id: "node_1", name: "主存储", driver: "LOCAL" }],
				});
				render(<ShareFilePicker nodes={[{ id: "node_1", name: "主存储", driver: "LOCAL" }]} />);
				const btn = await screen.findByRole("button", { name: "根目录" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(btn.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});
	});
});
