import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "zh" }) }));

import { useProviderForm } from "../hooks/use-provider-form";

describe("useProviderForm", () => {
	beforeEach(() => {
		fetchMock.mockReset();
	});

	const filled = (result: { current: ReturnType<typeof useProviderForm> }) => act(() => {
		result.current.setProvForm((form) => ({ ...form, name: "OpenAI", apiKey: "sk-test", baseUrl: " https://api.example.com/v1 ", availableModels: "gpt-a, gpt-b ,," }));
	});

	it("creates the provider with a trimmed address and model list, then empties the form", async () => {
		fetchMock.mockResolvedValue({});
		const refreshProviders = vi.fn();
		const addToast = vi.fn();
		const { result } = renderHook(() => useProviderForm({ refreshProviders, addToast }));
		filled(result);
		await act(async () => { await result.current.handleCreateProvider(); });

		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/ai/providers");
		expect(JSON.parse(init.body)).toMatchObject({ name: "OpenAI", baseUrl: "https://api.example.com/v1", models: "gpt-a,gpt-b", availableModels: ["gpt-a", "gpt-b"] });
		expect(refreshProviders).toHaveBeenCalledOnce();
		expect(result.current.provForm.name).toBe("");
		expect(addToast).not.toHaveBeenCalled();
	});

	it("says why the provider was refused in the server's words and keeps what was typed", async () => {
		// The toast read "添加失败" whatever the server had answered (an address it may not call, a duplicate name).
		fetchMock.mockRejectedValue(new Error("Base URL 指向内网地址，已拒绝"));
		const addToast = vi.fn();
		const { result } = renderHook(() => useProviderForm({ refreshProviders: vi.fn(), addToast }));
		filled(result);
		await act(async () => { await result.current.handleCreateProvider(); });

		expect(addToast).toHaveBeenCalledWith("error", "Base URL 指向内网地址，已拒绝");
		expect(result.current.provForm.name).toBe("OpenAI");
		expect(result.current.creating).toBe(false);
	});

	it("asks for a name and a key before sending anything", async () => {
		const addToast = vi.fn();
		const { result } = renderHook(() => useProviderForm({ refreshProviders: vi.fn(), addToast }));
		await act(async () => { await result.current.handleCreateProvider(); });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(addToast).toHaveBeenCalledWith("error", "aiPage.nameAndKeyRequired");
	});
});
