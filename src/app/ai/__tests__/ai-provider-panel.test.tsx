import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiProviderPanel } from "../ai-provider-panel";
import { DEFAULT_PROV_FORM } from "../ai-types";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

vi.mock("@/components/toast-provider", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const providerFixture = {
  id: "provider-1",
  name: "OpenAI",
  type: "OPENAI_COMPATIBLE",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o-mini",
  availableModels: "gpt-4o-mini,gpt-4o",
  isDefault: true,
  enabled: true,
  settings: "{}",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

describe("AiProviderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches provider models from credentials and lets the user choose instead of typing models manually", async () => {
    const user = userEvent.setup();
    const setProvForm = vi.fn((updater) => {
      if (typeof updater === "function") updater(DEFAULT_PROV_FORM);
    });

    vi.mocked(csrfFetch).mockResolvedValueOnce({
      models: [
        { id: "gpt-4o-mini", name: "gpt-4o-mini" },
        { id: "gpt-4o", name: "gpt-4o" },
      ],
    });

    render(
      <AiProviderPanel
        show
        providers={[]}
        provForm={{
          ...DEFAULT_PROV_FORM,
          name: "OpenAI",
          apiKey: "sk-test",
          baseUrl: "",
          defaultModel: "",
          availableModels: "",
        }}
        onClose={vi.fn()}
        onCreateProvider={vi.fn()}
        onDeleteProvider={vi.fn()}
        onRefreshProviders={vi.fn()}
        setProvForm={setProvForm}
      />,
    );

    expect(screen.queryByLabelText("可用模型")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /获取模型清单/ }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/models/probe", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "OPENAI_COMPATIBLE",
          apiKey: "sk-test",
        }),
      }));
    });

    const combo = await screen.findByLabelText("默认模型");
    expect(combo).toHaveRole("combobox");
    expect(screen.getByRole("option", { name: "gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gpt-4o" })).toBeInTheDocument();

    await user.selectOptions(combo, "gpt-4o");
    expect(setProvForm).toHaveBeenCalledWith(expect.any(Function));
  });

  it("lets users edit an existing provider inside the panel without browser prompts", async () => {
    const user = userEvent.setup();
    const setProvForm = vi.fn();

    render(
      <AiProviderPanel
        show
        providers={[providerFixture]}
        provForm={DEFAULT_PROV_FORM}
        onClose={vi.fn()}
        onCreateProvider={vi.fn()}
        onDeleteProvider={vi.fn()}
        onRefreshProviders={vi.fn()}
        setProvForm={setProvForm}
      />,
    );

    const promptSpy = vi.spyOn(window, "prompt");

    await user.click(screen.getByRole("button", { name: "编辑 OpenAI" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "编辑提供商" })).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue("OpenAI");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText("默认模型")).toHaveValue("gpt-4o-mini");
    expect(screen.getByLabelText(/API Key/)).toHaveAttribute("placeholder", "留空保持不变");

    await user.clear(screen.getByLabelText("默认模型"));
    await user.type(screen.getByLabelText("默认模型"), "gpt-4o");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/providers/provider-1", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "OpenAI",
          type: "OPENAI_COMPATIBLE",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4o",
          availableModels: ["gpt-4o-mini", "gpt-4o"],
          isDefault: true,
        }),
      }));
    });
  });
});
