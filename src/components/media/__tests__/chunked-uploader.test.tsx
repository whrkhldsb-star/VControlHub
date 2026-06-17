/**
 * TR-009 55c: chunked media uploader hook tests.
 *
 * Covers the three-state happy path (init → chunks → complete), resume
 * from a partially-uploaded session, MIME validation in the service
 * (skipped client-side here; the hook just routes correctly), and
 * failure propagation. We mock the global fetch + csrfFetch to keep the
 * test hermetic and avoid network I/O.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	CHUNKED_THRESHOLD_BYTES,
	useChunkedMediaUpload,
} from "@/components/media/chunked-uploader";

// Stable CSRF cookie across the test.
function setCsrfCookie(value: string): void {
	document.cookie = `csrf_token=${value}; path=/`;
}

function clearCsrfCookie(): void {
	document.cookie = "csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT";
}

function buildFile(name: string, sizeBytes: number, type = "image/png"): File {
	const buf = new Uint8Array(sizeBytes);
	for (let i = 0; i < sizeBytes; i++) buf[i] = i & 0xff;
	const file = new File([buf], name, { type, lastModified: 1700000000000 });
	return file;
}

interface MockInitResponse {
	session: {
		id: string;
		filename: string;
		mimeType: string;
		totalSize: number;
		chunkSize: number;
		totalChunks: number;
		receivedChunks: number[];
		storageNodeId: string | null;
		relativePath: string | null;
		status: "PENDING" | "UPLOADING" | "COMPLETED" | "CANCELLED" | "FAILED";
		resultImageId: string | null;
		checksum: string | null;
		errorMessage: string | null;
		completedAt: string | null;
		expiresAt: string;
		createdAt: string;
		updatedAt: string;
	};
}

function buildSession(opts: {
	id: string;
	totalSize: number;
	chunkSize: number;
	received?: number[];
	status?: "PENDING" | "UPLOADING" | "COMPLETED" | "CANCELLED" | "FAILED";
}): MockInitResponse["session"] {
	const totalChunks = Math.ceil(opts.totalSize / opts.chunkSize);
	return {
		id: opts.id,
		filename: "test.bin",
		mimeType: "image/png",
		totalSize: opts.totalSize,
		chunkSize: opts.chunkSize,
		totalChunks,
		receivedChunks: opts.received ?? [],
		storageNodeId: null,
		relativePath: null,
		status: opts.status ?? "PENDING",
		resultImageId: null,
		checksum: null,
		errorMessage: null,
		completedAt: null,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

describe("useChunkedMediaUpload", () => {
	beforeEach(() => {
		setCsrfCookie("test-csrf-token");
		localStorage.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		clearCsrfCookie();
		localStorage.clear();
	});

	it("routes files below the threshold through the existing single-shot path (not used here, threshold is the route boundary)", () => {
		// Document the threshold so future refactors don't accidentally change it.
		expect(CHUNKED_THRESHOLD_BYTES).toBe(5 * 1024 * 1024);
	});

	it("drives init → chunks → complete for a 12MB file split into 4 chunks", async () => {
		const totalSize = 12 * 1024 * 1024;
		const chunkSize = 3 * 1024 * 1024;
		const file = buildFile("big.png", totalSize);

		const initSession = buildSession({
			id: "sess_init",
			totalSize,
			chunkSize,
			status: "PENDING",
		});
		const completedSession = {
			...initSession,
			receivedChunks: [0, 1, 2, 3],
			status: "COMPLETED" as const,
		};

		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? "GET").toUpperCase();
			if (url === "/api/images/upload/init" && method === "POST") {
				return new Response(JSON.stringify({ session: initSession }), {
					status: 201,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/chunk") && method === "PUT") {
				const sessionAfter = { ...initSession, status: "UPLOADING" as const, receivedChunks: initSession.receivedChunks };
				return new Response(JSON.stringify({ session: sessionAfter }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/complete") && method === "POST") {
				return new Response(
					JSON.stringify({ session: completedSession, image: { id: "img_1", publicUrl: "/api/images/img_1/file" } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const onProgress = vi.fn();
		const { result } = renderHook(() => useChunkedMediaUpload({ onProgress }));
		const complete = await act(async () => {
			return await result.current.upload(file);
		});

		expect(complete.image.id).toBe("img_1");
		expect(complete.image.publicUrl).toBe("/api/images/img_1/file");
		// 1 init + 4 chunks + 1 complete = 6 fetch calls
		expect(fetchMock).toHaveBeenCalledTimes(6);
		// last call is complete
		const calls = fetchMock.mock.calls;
		const lastCall = calls[calls.length - 1]!;
		expect(String(lastCall[0])).toMatch(/\/complete$/);
		expect((lastCall[1]?.method ?? "GET").toUpperCase()).toBe("POST");
		// progress emitted at least once
		expect(onProgress).toHaveBeenCalled();
		// localStorage cleared on success
		expect(Object.keys(localStorage).filter((k) => k.startsWith("vcMediaUploadSession:"))).toEqual([]);
	});

	it("resumes from a partially-uploaded session by skipping already-received chunks", async () => {
		const totalSize = 6 * 1024 * 1024;
		const chunkSize = 3 * 1024 * 1024;
		const file = buildFile("resumable.png", totalSize);

		// Pre-seed localStorage with a session for this file fingerprint.
		const fingerprint = `vcMediaUploadSession:${file.name}:${file.size}:${file.lastModified}`;
		const sessionId = "sess_resume";
		localStorage.setItem(
			fingerprint,
			JSON.stringify({
				sessionId,
				filename: file.name,
				size: file.size,
				lastChunkSize: chunkSize,
				lastModified: file.lastModified,
			}),
		);

		const existingSession = buildSession({
			id: sessionId,
			totalSize,
			chunkSize,
			received: [0], // chunk 0 already uploaded
			status: "UPLOADING",
		});
		const completedSession = {
			...existingSession,
			receivedChunks: [0, 1],
			status: "COMPLETED" as const,
		};

		let getStatusCallCount = 0;
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? "GET").toUpperCase();
			// GET status (used by resume lookup) — must match `/api/images/upload/<id>` (no /chunk or /complete suffix)
			if (method === "GET" && url === `/api/images/upload/${sessionId}`) {
				getStatusCallCount++;
				return new Response(JSON.stringify({ session: existingSession }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/chunk") && method === "PUT") {
				const urlObj = new URL(url, "http://localhost");
				const index = Number(urlObj.searchParams.get("index"));
				const sessionAfter = {
					...existingSession,
					receivedChunks: [...existingSession.receivedChunks, index].sort((a, b) => a - b),
					status: "UPLOADING" as const,
				};
				return new Response(JSON.stringify({ session: sessionAfter }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/complete") && method === "POST") {
				return new Response(
					JSON.stringify({ session: completedSession, image: { id: "img_2", publicUrl: "/api/images/img_2/file" } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const onProgress = vi.fn();
		const { result } = renderHook(() => useChunkedMediaUpload({ onProgress }));
		const complete = await act(async () => {
			return await result.current.upload(file);
		});

		expect(complete.image.id).toBe("img_2");
		// GET status + 1 remaining chunk (index 1) + complete = 3 fetch calls
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(getStatusCallCount).toBe(1);
		// First progress should be flagged as resumed + skipped=1
		const firstProgress = onProgress.mock.calls[0]?.[0];
		expect(firstProgress?.resumed).toBe(true);
		expect(firstProgress?.skipped).toBe(1);
	});

	it("surfaces server errors from the chunk PUT as the hook's error state", async () => {
		const totalSize = 4 * 1024 * 1024;
		const chunkSize = 2 * 1024 * 1024;
		const file = buildFile("bad.png", totalSize);

		const initSession = buildSession({ id: "sess_err", totalSize, chunkSize });

		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? "GET").toUpperCase();
			if (url === "/api/images/upload/init" && method === "POST") {
				return new Response(JSON.stringify({ session: initSession }), {
					status: 201,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/chunk") && method === "PUT") {
				return new Response(JSON.stringify({ error: "session_expired" }), {
					status: 410,
					headers: { "content-type": "application/json" },
				});
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => useChunkedMediaUpload());
		await act(async () => {
			await expect(result.current.upload(file)).rejects.toThrow();
		});

		expect(result.current.status).toBe("error");
		expect(result.current.error).toBe("session_expired");
		// localStorage cleared so a retry starts fresh
		expect(Object.keys(localStorage).filter((k) => k.startsWith("vcMediaUploadSession:"))).toEqual([]);
	});
});
