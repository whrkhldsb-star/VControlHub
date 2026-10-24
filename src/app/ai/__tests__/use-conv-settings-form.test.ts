import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "zh" }) }));

import type { ConvItem } from "../ai-types";
import { useConvSettingsForm } from "../hooks/use-conv-settings-form";

const conversation = (model: string): ConvItem => ({
	id: "conv-1", title: "c", providerId: "p", model, systemPrompt: "", temperature: 0.7, maxTokens: 4096, topP: 1,
	frequencyPenalty: 0, presencePenalty: 0, enableVision: false, hostingEnabled: false, automationMode: "ASSISTED",
	createdBy: "u", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", provider: null,
});

/**
 * A model chosen from the header's quick switch must survive a later save
 * of the settings panel. The panel sent its whole form, loaded when the
 * conversation opened, and put the old model back.
 */
describe("useConvSettingsForm after a quick model switch", () => {
	it("shows the new model and saves only what was changed here", async () => {
		const props = { activeConvId: "conv-1", refreshConversations: vi.fn(), onSaved: vi.fn(), addToast: vi.fn() };
		const { result, rerender } = renderHook(({ conv }) => useConvSettingsForm({ ...props, activeConv: conv }), { initialProps: { conv: conversation("model-a") } });
		await waitFor(() => expect(result.current.settingsForm.model).toBe("model-a"));

		rerender({ conv: conversation("model-b") });
		await waitFor(() => expect(result.current.settingsForm.model).toBe("model-b"));

		act(() => result.current.setSettingsForm((form) => ({ ...form, systemPrompt: "Be brief." })));
		await act(async () => {
			await result.current.handleSaveSettings();
		});
		expect(fetchMock).toHaveBeenCalledWith("/api/ai/conversations/conv-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ systemPrompt: "Be brief." }) }));
	});
});

describe("useConvSettingsForm when a save returns after a conversation switch", () => {
	it("keeps the late response out of the other conversation's form", async () => {
		// Saved in A; before the response came back, B was opened and edited
		// to the same temperature. The late response made A's snapshot B's
		// baseline, B no longer looked changed, and its PATCH was empty.
		let release: () => void = () => undefined;
		fetchMock.mockReset();
		fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
		fetchMock.mockImplementation(async () => ({}));
		const onSaved = vi.fn();
		const props = { refreshConversations: vi.fn(), onSaved, addToast: vi.fn() };
		const a = { ...conversation("m"), id: "conv-a", temperature: 0.4 };
		const b = { ...conversation("m"), id: "conv-b", temperature: 0.5 };
		const { result, rerender } = renderHook(({ conv }) => useConvSettingsForm({ ...props, activeConv: conv, activeConvId: conv.id }), { initialProps: { conv: a } });
		await waitFor(() => expect(result.current.settingsForm.temperature).toBe(0.4));
		act(() => result.current.setSettingsForm((form) => ({ ...form, temperature: 0.8 })));
		let saving!: Promise<void>;
		act(() => { saving = result.current.handleSaveSettings(); });

		rerender({ conv: b });
		await waitFor(() => expect(result.current.settingsForm.temperature).toBe(0.5));
		act(() => result.current.setSettingsForm((form) => ({ ...form, temperature: 0.8 })));
		await act(async () => { release(); await saving; });

		expect(result.current.dirty).toBe(true);
		expect(onSaved).not.toHaveBeenCalled();
		await act(async () => { await result.current.handleSaveSettings(); });
		expect(fetchMock).toHaveBeenLastCalledWith("/api/ai/conversations/conv-b", expect.objectContaining({ body: JSON.stringify({ temperature: 0.8 }) }));
		expect(onSaved).toHaveBeenCalledTimes(1);
	});
});
