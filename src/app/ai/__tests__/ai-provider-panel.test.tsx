import { render, screen, waitFor } from "@testing-library/react";
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
          baseUrl: "https://api.openai.com/v1",
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
          baseUrl: "https://api.openai.com/v1",
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
});
