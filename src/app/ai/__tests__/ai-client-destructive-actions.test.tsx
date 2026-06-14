import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiClient } from "../ai-client";
import type { ConvItem, Provider } from "../ai-types";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const addToastMock = vi.fn();
vi.mock("@/components/toast-provider", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock("next/image", () => ({
  default: ({
    unoptimized: _unoptimized,
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean; fill?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...props} />;
  },
}));

const provider: Provider = {
  id: "provider-1",
  name: "OpenAI",
  type: "OPENAI_COMPATIBLE",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o-mini",
  availableModels: "gpt-4o-mini",
  isDefault: true,
  enabled: true,
  settings: "{}",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

const conversation: ConvItem = {
  id: "conv-1",
  title: "生产排障助手",
  providerId: "provider-1",
  model: "gpt-4o-mini",
  systemPrompt: null,
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  enableVision: false,
  hostingEnabled: false,
  createdBy: "user-1",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
  provider: { id: "provider-1", name: "OpenAI", type: "OPENAI_COMPATIBLE" },
};

function mockAiFetches() {
  vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/ai/conversations/conv-1" && !init) {
      return { conversation: { ...conversation, messages: [] } };
    }
    if (url === "/api/ai/models?providerId=provider-1") {
      return { models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini" }] };
    }
    if (url === "/api/ai/conversations") {
      return { conversations: [conversation] };
    }
    if (url === "/api/ai/providers") {
      return { providers: [provider] };
    }
    return {};
  });
}

describe("AiClient destructive actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mockAiFetches();
  });

  it("uses an in-app dialog before deleting a conversation instead of a browser confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} />);

    await user.click(screen.getByText("生产排障助手"));
    await screen.findByText(/OpenAI · gpt-4o-mini/);
    await user.click(screen.getByRole("button", { name: "删除对话 生产排障助手" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "删除对话" });
    expect(dialog).toHaveTextContent("生产排障助手");
    expect(csrfFetch).not.toHaveBeenCalledWith("/api/ai/conversations/conv-1", expect.objectContaining({ method: "DELETE" }));

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "删除对话" })).not.toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalledWith("/api/ai/conversations/conv-1", expect.objectContaining({ method: "DELETE" }));

    await user.click(screen.getByRole("button", { name: "删除对话 生产排障助手" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/conversations/conv-1", { method: "DELETE" });
    });
  });

  it("keeps the clear-message dialog open and surfaces API failure", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/ai/conversations/conv-1" && init?.method === "PATCH") {
        throw new Error("清空失败");
      }
      if (url === "/api/ai/conversations/conv-1" && !init) {
        return { conversation: { ...conversation, messages: [] } };
      }
      if (url === "/api/ai/models?providerId=provider-1") {
        return { models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini" }] };
      }
      return {};
    });

    render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} />);
    await user.click(screen.getByText("生产排障助手"));
    await screen.findByText(/OpenAI · gpt-4o-mini/);

    await user.click(screen.getByRole("button", { name: /清空/ }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "清空对话消息" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认清空" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("清空失败");
    expect(screen.getByRole("dialog", { name: "清空对话消息" })).toBeInTheDocument();
  });

  it("opens a rename dialog instead of using prompt and updates the title through csrfFetch", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt");

    render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} />);
    await user.click(screen.getByText("生产排障助手"));
    await screen.findByText(/OpenAI · gpt-4o-mini/);
    await user.click(screen.getByRole("button", { name: "✏ 重命名" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "修改对话标题" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("新标题"));
    await user.type(screen.getByLabelText("新标题"), "新的标题");
    await user.click(screen.getByRole("button", { name: "保存标题" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/conversations/conv-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新的标题" }),
      });
    });
    expect(addToastMock).toHaveBeenCalledWith("success", "对话标题已更新");
  });

  it("opens the provider setup as an accessible dialog when no enabled provider exists", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValue({});

    render(<AiClient userId="user-1" initialProviders={[]} initialConversations={[]} />);

    await user.click(screen.getAllByRole("button", { name: "+ 新对话" })[0]!);

    expect(addToastMock).toHaveBeenCalledWith("error", "请先添加一个 AI 提供商");
    const dialog = screen.getByRole("dialog", { name: "AI 提供商管理" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("关闭提供商管理")).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalledWith(
      "/api/ai/conversations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses an in-app dialog before deleting a provider", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} />);

    await user.click(screen.getByRole("button", { name: "提供商管理" }));
    await user.click(screen.getByRole("button", { name: "删除提供商 OpenAI" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "删除提供商" });
    expect(dialog).toHaveTextContent("OpenAI");
    expect(csrfFetch).not.toHaveBeenCalledWith("/api/ai/providers/provider-1", expect.objectContaining({ method: "DELETE" }));

    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/providers/provider-1", { method: "DELETE" });
    });
  });
});
