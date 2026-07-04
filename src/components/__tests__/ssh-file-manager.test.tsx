import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";

import { SshFileManager } from "../ssh-file-manager";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		csrfFetch: vi.fn(),
	},
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: mocks.csrfFetch,
}));

const fileEntries = [
	{ name: "report.txt", isDirectory: false, isFile: true, isSymlink: false, size: 1024, modifyTime: 1700000000 },
	{ name: "docs", isDirectory: true, isFile: false, isSymlink: false, size: 0, modifyTime: 1700000000 },
	{ name: "link.conf", isDirectory: false, isFile: true, isSymlink: true, size: 256, modifyTime: 1700000000 },
];

describe("SshFileManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockImplementation(async (url: string) => {
			if (url.includes("/sftp/list")) {
				return { path: "/root", entries: fileEntries };
			}
			return {};
		});
	});

	it("loads and displays the remote file listing on first visible", async () => {
		render(<SshFileManager serverId="srv1" visible={true} />);

		expect(mocks.csrfFetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/servers/srv1/sftp/list"),
			expect.objectContaining({ method: "POST" }),
		);

		await waitFor(() => {
			expect(screen.getByText("report.txt")).toBeInTheDocument();
			expect(screen.getByText("docs")).toBeInTheDocument();
			expect(screen.getByText("link.conf")).toBeInTheDocument();
		});
	});

	it("does not render when visible is false", () => {
		const { container } = render(<SshFileManager serverId="srv1" visible={false} />);
		expect(container.firstChild).toBeNull();
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
	});

	it("shows file icons based on entry type", async () => {
		render(<SshFileManager serverId="srv1" visible={true} />);
		await waitFor(() => screen.getByText("report.txt"));
		// Breadcrumb also renders a directory icon, so at least one of each type exists
		expect(screen.getAllByText("📁").length).toBeGreaterThanOrEqual(1); // directory
		expect(screen.getByText("📄")).toBeInTheDocument(); // file
		expect(screen.getByText("🔗")).toBeInTheDocument(); // symlink
	});

	it("downloads a file via window.open when the download button is clicked", async () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		render(<SshFileManager serverId="srv1" visible={true} />);
		await waitFor(() => screen.getByText("report.txt"));

		// Two file entries (report.txt, link.conf) each render a download button
		const downloadBtns = screen.getAllByRole("button", { name: "下载" });
		await act(async () => {
			fireEvent.click(downloadBtns[0]!);
		});

		expect(openSpy).toHaveBeenCalledWith(
			expect.stringContaining("/api/servers/srv1/sftp/download"),
			"_blank",
		);
		openSpy.mockRestore();
	});

	it("uploads files via XMLHttpRequest when the file input changes", async () => {
		const xhrInstances: MockXHR[] = [];
		class MockXHR {
			upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
			status = 0;
			response = "";
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			open = vi.fn();
			setRequestHeader = vi.fn();
			send = vi.fn(function (this: MockXHR) {
				queueMicrotask(() => {
					this.status = 200;
					this.onload?.();
				});
			});
			constructor() { xhrInstances.push(this); }
		}
		vi.stubGlobal("XMLHttpRequest", MockXHR);

		render(<SshFileManager serverId="srv1" visible={true} />);
		await waitFor(() => screen.getByText("report.txt"));

		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File(["content"], "upload.txt", { type: "text/plain" });

		await act(async () => {
			fireEvent.change(input, { target: { files: [file] } });
		});

		await waitFor(() => {
			expect(xhrInstances.length).toBeGreaterThan(0);
		});
		expect(xhrInstances[0]!.open).toHaveBeenCalledWith("POST", expect.stringContaining("/sftp/upload"));

		vi.unstubAllGlobals();
	});

	it("creates a new folder via csrfFetch when the mkdir form is submitted", async () => {
		render(<SshFileManager serverId="srv1" visible={true} />);
		await waitFor(() => screen.getByText("report.txt"));

		// Open the mkdir input
		const newFolderBtn = screen.getByRole("button", { name: "新建文件夹" });
		await act(async () => {
			fireEvent.click(newFolderBtn);
		});

		const input = screen.getByPlaceholderText("文件夹名称…") as HTMLInputElement;
		await act(async () => {
			fireEvent.change(input, { target: { value: "newdir" } });
		});
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(() => {
			expect(mocks.csrfFetch).toHaveBeenCalledWith(
				expect.stringContaining("/sftp/mkdir"),
				expect.objectContaining({ method: "POST" }),
			);
		});
	});
});
