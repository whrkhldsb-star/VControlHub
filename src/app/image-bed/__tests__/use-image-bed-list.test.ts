/**
 * useImageBedList — pure-logic hook tests.
 * Verifies the list-fetch contract: URL params, debounce-free initial
 * fetch, search/showAll filter changes, and the throw-on-error path so
 * the parent can surface a toast.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useImageBedList } from "../use-image-bed-list";

const csrfFetchMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

const sampleListResponse = {
	images: [
		{
			id: "img_1",
			filename: "cat.png",
			mimeType: "image/png",
			sizeBytes: 1234,
			album: null,
			isPublic: true,
			createdAt: "2026-06-14T00:00:00Z",
			publicUrl: "https://example.com/cat.png",
		},
	],
	total: 1,
	totalPages: 1,
};

describe("useImageBedList", () => {
	beforeEach(() => {
		csrfFetchMock.mockReset();
	});

	it("issues the initial fetch on mount with page=1 and no filters", async () => {
		csrfFetchMock.mockResolvedValueOnce(sampleListResponse);
		const { result } = renderHook(() => useImageBedList({ canWrite: true }));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledTimes(1));
		const [url] = csrfFetchMock.mock.calls[0] as [string];
		expect(url).toContain("/api/images/list?");
		expect(url).toContain("page=1");
		expect(url).toContain("limit=30");
		expect(url).not.toContain("q=");
		expect(url).not.toContain("all=");
		await waitFor(() => expect(result.current.images).toEqual(sampleListResponse.images));
	});

	it("re-fetches when search changes", async () => {
		csrfFetchMock.mockResolvedValue(sampleListResponse);
		const { result } = renderHook(() => useImageBedList({ canWrite: true }));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledTimes(1));
		act(() => result.current.setSearch("cat"));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledTimes(2));
		const [url] = csrfFetchMock.mock.calls[1] as [string];
		expect(url).toContain("q=cat");
	});

	it("re-fetches when showAll toggles, adding all=true", async () => {
		csrfFetchMock.mockResolvedValue(sampleListResponse);
		const { result } = renderHook(() => useImageBedList({ canWrite: true }));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledTimes(1));
		act(() => result.current.setShowAll(true));
		await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledTimes(2));
		const [url] = csrfFetchMock.mock.calls[1] as [string];
		expect(url).toContain("all=true");
	});

	it("throws on fetch failure so the parent can show a toast", async () => {
		csrfFetchMock.mockRejectedValueOnce(new Error("network"));
		const { result } = renderHook(() => useImageBedList({ canWrite: true }));
		await waitFor(() => expect(result.current.loading).toBe(false));
		// Subsequent manual fetchImages call should reject with a typed marker
		// so the parent can distinguish "list fetch failed" from a generic error.
		await act(async () => {
			await expect(result.current.fetchImages(2)).rejects.toThrow("list-fetch-failed");
		});
	});

	it("captures total + totalPages and the requested page number", async () => {
		csrfFetchMock.mockResolvedValue({
			images: sampleListResponse.images,
			total: 50,
			totalPages: 5,
		});
		const { result } = renderHook(() => useImageBedList({ canWrite: true }));
		await waitFor(() => expect(result.current.total).toBe(50));
		expect(result.current.totalPages).toBe(5);
		await act(async () => {
			await result.current.fetchImages(3);
		});
		expect(result.current.page).toBe(3);
	});
});
