import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { MediaImageUploadPanel } from "../media-image-upload-panel";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

describe("MediaImageUploadPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads storage nodes and uploads multiple image files with progress", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url === "/api/storage/nodes") {
				return {
					nodes: [
						{ id: "node_1", name: "本机图片", driver: "LOCAL" },
					],
				};
			}
			if (url === "/api/images/upload") return { publicUrl: "/api/images/img_1/file" };
			throw new Error(`unexpected request: ${url}`);
		});

		render(<MediaImageUploadPanel />);

		await user.click(screen.getByRole("button", { name: "加载存储节点" }));
		expect(await screen.findByRole("option", { name: "本机图片 · LOCAL" })).toBeInTheDocument();

		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, {
			target: {
				files: [
					new File(["one"], "one.png", { type: "image/png" }),
					new File(["two"], "two.jpg", { type: "image/jpeg" }),
				],
			},
		});

		expect(await screen.findByRole("status", { name: "媒体图片上传进度" })).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText(/上传完成：成功 2 张/)).toBeInTheDocument());
		expect(csrfFetch).toHaveBeenCalledWith("/api/images/upload", expect.objectContaining({ method: "POST" }));
	});

	it("skips non-image files instead of pretending they uploaded", async () => {
		render(<MediaImageUploadPanel />);
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, {
			target: { files: [new File(["txt"], "note.txt", { type: "text/plain" })] },
		});

		expect(await screen.findByRole("alert")).toHaveTextContent("上传失败：1/1 张未上传");
		expect(screen.getByText(/note\.txt/)).toHaveTextContent("不是图片文件");
		expect(csrfFetch).not.toHaveBeenCalledWith("/api/images/upload", expect.anything());
	});
});
