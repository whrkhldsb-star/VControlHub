import { act, fireEvent, renderHook, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiPinnedServers } from "../ai-pinned-servers";
import type { AiServerOption, ConvItem } from "../ai-types";
import { MAX_PINNED_SERVERS, usePinnedServers } from "../hooks/use-pinned-servers";

const servers: AiServerOption[] = [
	{ id: "srv-1", name: "web-1", host: "10.0.0.1" },
	{ id: "srv-2", name: "db-1", host: "10.0.0.2" },
	{ id: "srv-3", name: "cache-1", host: "10.0.0.3" },
];

describe("AiPinnedServers", () => {
	it("shows the pinned servers by name and unpins one", () => {
		const onChange = vi.fn();
		render(<AiPinnedServers servers={servers} pinnedIds={["srv-1", "srv-2"]} canEdit onChange={onChange} />);
		expect(screen.getByText("固定的服务器")).toBeInTheDocument();
		expect(screen.getByText("web-1")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "取消固定 db-1" }));
		expect(onChange).toHaveBeenCalledWith(["srv-1"]);
	});

	it("pins a server picked from the searchable list", () => {
		const onChange = vi.fn();
		render(<AiPinnedServers servers={servers} pinnedIds={["srv-1"]} canEdit onChange={onChange} />);
		fireEvent.click(screen.getByRole("button", { name: "固定服务器" }));
		const list = screen.getByRole("listbox", { name: "选择要固定的服务器" });
		expect(within(list).getByRole("option", { name: /web-1/ })).toHaveAttribute("aria-selected", "true");
		fireEvent.change(screen.getByRole("searchbox", { name: "搜索服务器" }), { target: { value: "cache" } });
		expect(within(list).getAllByRole("option")).toHaveLength(1);
		fireEvent.click(within(list).getByRole("option", { name: /cache-1/ }));
		expect(onChange).toHaveBeenCalledWith(["srv-1", "srv-3"]);
		fireEvent.change(screen.getByRole("searchbox", { name: "搜索服务器" }), { target: { value: "nothing-like-it" } });
		expect(screen.getByText("没有匹配的服务器")).toBeInTheDocument();
	});

	it("names a pin it cannot list by its id, read-only without server:read", () => {
		render(<AiPinnedServers servers={[]} pinnedIds={["srv-hidden-123456"]} canEdit={false} onChange={vi.fn()} />);
		expect(screen.getByText("服务器 srv-hidden")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /取消固定/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "固定服务器" })).not.toBeInTheDocument();
	});

	it("draws nothing with no pins and nothing to pick", () => {
		const { container } = render(<AiPinnedServers servers={[]} pinnedIds={[]} canEdit={false} onChange={vi.fn()} />);
		expect(container.querySelector("[data-ai-pinned-servers]")).toBeNull();
	});

	it("stops adding at the limit the API accepts", () => {
		const many = Array.from({ length: MAX_PINNED_SERVERS }, (_, index) => ({ id: `s-${index}`, name: `n-${index}`, host: `h-${index}` }));
		render(<AiPinnedServers servers={many} pinnedIds={many.map((server) => server.id)} canEdit onChange={vi.fn()} />);
		expect(screen.getByRole("button", { name: "固定服务器" })).toBeDisabled();
	});
});

describe("usePinnedServers", () => {
	const conv = { id: "conv-1", pinnedServerIds: ["srv-1"] } as ConvItem;

	beforeEach(() => {
		fetchMock.mockReset();
	});

	it("saves the pins at once and shows them before the answer", async () => {
		let release!: (value: unknown) => void;
		fetchMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
		const updated = vi.fn();
		const { result } = renderHook(() => usePinnedServers({ activeConv: conv, onConversationUpdated: updated, addToast: vi.fn() }));
		let saving!: Promise<void>;
		act(() => { saving = result.current.setPinned(["srv-1", "srv-2", "srv-2"]); });
		expect(result.current.pinnedIds).toEqual(["srv-1", "srv-2"]);
		expect(result.current.saving).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith("/api/ai/conversations/conv-1", expect.objectContaining({
			method: "PATCH",
			body: JSON.stringify({ pinnedServerIds: ["srv-1", "srv-2"] }),
		}));
		await act(async () => {
			release({ conversation: { ...conv, pinnedServerIds: ["srv-1", "srv-2"] } });
			await saving;
		});
		expect(updated).toHaveBeenCalledWith(expect.objectContaining({ pinnedServerIds: ["srv-1", "srv-2"] }));
		expect(result.current.saving).toBe(false);
	});

	it("puts the pins back and says why when the server refuses them", async () => {
		fetchMock.mockRejectedValue(new Error("目标服务器不在当前范围内"));
		const addToast = vi.fn();
		const { result } = renderHook(() => usePinnedServers({ activeConv: conv, onConversationUpdated: vi.fn(), addToast }));
		await act(async () => { await result.current.setPinned(["srv-9"]); });
		expect(result.current.pinnedIds).toEqual(["srv-1"]);
		expect(addToast).toHaveBeenCalledWith("error", "目标服务器不在当前范围内");
	});
});
