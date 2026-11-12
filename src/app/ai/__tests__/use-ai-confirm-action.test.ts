import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderHookWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));

import { useAiConfirmAction } from "../hooks/use-ai-confirm-action";

const args = () => ({
	activeConvId: "c1",
	activeConvProviderId: "p1",
	clearActiveConv: vi.fn(),
	refreshConversations: vi.fn(),
	refreshProviders: vi.fn(),
	clearMessages: vi.fn(),
});

describe("useAiConfirmAction", () => {
	it("names the conversation or provider as it is written", () => {
		// Put in with String.replace, "$&" in a title came out as "{title}" and "$'" as the rest of the sentence.
		const { result } = renderHookWithI18n(() => useAiConfirmAction(args()));
		act(() => result.current.open({ type: "delete-conversation", id: "c1", title: "awk '{print $1}' $& $'" }));
		expect(result.current.copy?.description).toBe("确定删除对话 awk '{print $1}' $& $' 吗？此操作不可恢复。");

		act(() => result.current.open({ type: "delete-provider", id: "p1", name: "US$$ proxy" }));
		expect(result.current.copy?.description).toBe("确定删除提供商 US$$ proxy 吗？关联的对话也会被删除。");
	});

	it("deletes the open conversation, leaves it, and keeps the question open with the reason when refused", async () => {
		const given = args();
		const { result } = renderHook(() => useAiConfirmAction(given));
		fetchMock.mockRejectedValueOnce(new Error("对话正在生成回复，稍后再删"));
		act(() => result.current.open({ type: "delete-conversation", id: "c1", title: "t" }));
		await act(async () => { await result.current.run(); });
		expect(result.current.error).toBe("对话正在生成回复，稍后再删");
		expect(result.current.action).not.toBeNull();
		expect(given.clearActiveConv).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce({});
		await act(async () => { await result.current.run(); });
		expect(fetchMock).toHaveBeenLastCalledWith("/api/ai/conversations/c1", { method: "DELETE" });
		expect(given.clearActiveConv).toHaveBeenCalledOnce();
		expect(given.refreshConversations).toHaveBeenCalledOnce();
		expect(result.current.action).toBeNull();
	});
});
