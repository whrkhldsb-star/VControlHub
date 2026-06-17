import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

	it("routes files ≥ 5 MB through the chunked uploader and shows the chunked badge + progress", async () => {
		// 6 MB file → forced chunked path.
		const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });

		// Mock csrfFetch for the init + complete calls.
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url === "/api/images/upload/init") {
				return {
					session: {
						id: "sess_panel",
						filename: "big.png",
						mimeType: "image/png",
						totalSize: 6 * 1024 * 1024,
						chunkSize: 5 * 1024 * 1024,
						totalChunks: 2,
						receivedChunks: [],
						storageNodeId: null,
						relativePath: null,
						status: "PENDING",
						resultImageId: null,
						checksum: null,
						errorMessage: null,
						completedAt: null,
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				};
			}
			if (url === "/api/images/upload/sess_panel/complete") {
				return {
					session: {
						id: "sess_panel",
						filename: "big.png",
						mimeType: "image/png",
						totalSize: 6 * 1024 * 1024,
						chunkSize: 5 * 1024 * 1024,
						totalChunks: 2,
						receivedChunks: [0, 1],
						storageNodeId: null,
						relativePath: null,
						status: "COMPLETED",
						resultImageId: "img_42",
						checksum: null,
						errorMessage: null,
						completedAt: new Date().toISOString(),
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					image: { id: "img_42", publicUrl: "/api/images/img_42/file" },
				};
			}
			throw new Error(`unexpected csrfFetch: ${url}`);
		});

		// Mock global fetch for the chunk PUT + complete POST.
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? "GET").toUpperCase();
			if (url.includes("/chunk") && method === "PUT") {
				return new Response(
					JSON.stringify({
						session: {
							id: "sess_panel",
							filename: "big.png",
							mimeType: "image/png",
							totalSize: 6 * 1024 * 1024,
							chunkSize: 5 * 1024 * 1024,
							totalChunks: 2,
							receivedChunks: [0],
							storageNodeId: null,
							relativePath: null,
							status: "UPLOADING",
							resultImageId: null,
							checksum: null,
							errorMessage: null,
							completedAt: null,
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/complete") && method === "POST") {
				return new Response(
					JSON.stringify({
						session: {
							id: "sess_panel",
							filename: "big.png",
							mimeType: "image/png",
							totalSize: 6 * 1024 * 1024,
							chunkSize: 5 * 1024 * 1024,
							totalChunks: 2,
							receivedChunks: [0, 1],
							storageNodeId: null,
							relativePath: null,
							status: "COMPLETED",
							resultImageId: "img_42",
							checksum: null,
							errorMessage: null,
							completedAt: new Date().toISOString(),
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						},
						image: { id: "img_42", publicUrl: "/api/images/img_42/file" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<MediaImageUploadPanel />);
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [big] } });

		// The size-hint copy should be visible immediately.
		expect(screen.getByText(/≥ 5 MB 文件自动启用分片/)).toBeInTheDocument();

		// Wait for completion summary.
		expect(await screen.findByText(/上传完成：成功 1 张/)).toBeInTheDocument();

		// The chunked badge should have rendered at some point.
		expect(screen.getAllByText("分片").length).toBeGreaterThan(0);

		// Init was called via csrfFetch; chunks + complete via global fetch.
		expect(csrfFetch).toHaveBeenCalledWith("/api/images/upload/init", expect.objectContaining({ method: "POST" }));
		expect(fetchMock).toHaveBeenCalled();
	});
});
