import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  fetchProviderModels,
  postProviderChat,
  aiHttpErrorMessage,
  trimProviderBaseUrl,
} from "./provider-http";

describe("ai provider-http adapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("trimProviderBaseUrl", () => {
    it("returns the trimmed value and strips trailing slashes", () => {
      expect(trimProviderBaseUrl(" https://api.openai.com/v1/ ", "https://default.example/v1")).toBe(
        "https://api.openai.com/v1",
      );
    });

    it("strips multiple trailing slashes", () => {
      expect(trimProviderBaseUrl("https://api.example.com/v1///", "fallback")).toBe(
        "https://api.example.com/v1",
      );
    });

    it("falls back when input is undefined or whitespace", () => {
      expect(trimProviderBaseUrl(undefined, "https://default.example/v1")).toBe(
        "https://default.example/v1",
      );
      expect(trimProviderBaseUrl("   ", "https://default.example/v1///")).toBe(
        "https://default.example/v1",
      );
    });
  });

  describe("aiHttpErrorMessage", () => {
    it("returns a generic message for model list failures (preserves Site 1 copy)", () => {
      expect(aiHttpErrorMessage(401, "Unauthorized", "models")).toBe(
        "模型清单获取失败，请检查 API Key 和 Base URL",
      );
    });

    it("ignores errorText for the models kind", () => {
      expect(aiHttpErrorMessage(500, "internal", "models")).toBe(
        "模型清单获取失败，请检查 API Key 和 Base URL",
      );
    });

    it("formats chat kind with status code and truncated body", () => {
      expect(aiHttpErrorMessage(429, "rate limit", "chat")).toBe("AI 请求失败 (429): rate limit");
    });

    it("falls back to Unknown error when chat body is empty", () => {
      expect(aiHttpErrorMessage(500, "", "chat")).toBe("AI 请求失败 (500): Unknown error");
    });

    it("truncates chat error body to 500 chars", () => {
      const long = "x".repeat(800);
      const message = aiHttpErrorMessage(500, long, "chat");
      expect(message.length).toBe("AI 请求失败 (500): ".length + 500);
      expect(message.endsWith("x")).toBe(true);
    });
  });

  describe("fetchProviderModels", () => {
    it("GETs /models with Bearer auth and returns id-validated rows from data.data", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o", name: "GPT-4o", owned_by: "openai" },
              { id: "gpt-4.1" },
            ],
          }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const models = await fetchProviderModels({
        apiKey: " sk-test ",
        baseUrl: "https://api.openai.com/v1/",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/models");
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      expect(models).toEqual([
        { id: "gpt-4o", name: "GPT-4o", owned_by: "openai" },
        { id: "gpt-4.1" },
      ]);
    });

    it("falls back to data.models when data.data is absent", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ id: "claude-3.5" }] }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const models = await fetchProviderModels({
        apiKey: "sk-x",
        baseUrl: "https://api.example.com/v1",
      });

      expect(models).toEqual([{ id: "claude-3.5" }]);
    });

    it("filters out rows with missing or empty id", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "valid" },
              { id: "" },
              { name: "no id" },
              { id: "   " },
              { id: 123 },
            ],
          }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const models = await fetchProviderModels({
        apiKey: "sk-x",
        baseUrl: "https://api.example.com/v1",
      });

      expect(models.map((m) => m.id)).toEqual(["valid"]);
    });

    it("throws a generic 模型清单获取失败 message on non-2xx", async () => {
      const fetchMock = vi.fn(
        async () => new Response("upstream blew up", { status: 401, statusText: "Unauthorized" }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        fetchProviderModels({ apiKey: "sk-x", baseUrl: "https://api.example.com/v1" }),
      ).rejects.toThrow("模型清单获取失败，请检查 API Key 和 Base URL");
    });

    it("rejects empty API keys with the same 业务-side validation error", async () => {
      await expect(
        fetchProviderModels({ apiKey: "   ", baseUrl: "https://api.example.com/v1" }),
      ).rejects.toThrow("API Key 不能为空");
    });
  });

  describe("postProviderChat", () => {
    it("POSTs JSON body with Content-Type + caller headers, returns Response on 2xx", async () => {
      const fetchMock = vi.fn(
        async () => new Response("ok-stream", { status: 200, headers: { "x-trace": "abc" } }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const response = await postProviderChat({
        url: "https://api.openai.com/v1/chat/completions",
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
        headers: { Authorization: "Bearer sk-test" },
      });

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      expect(init.body).toBe(
        JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      );
      expect(await response.text()).toBe("ok-stream");
    });

    it("throws AI 请求失败 (status): <truncated body> on non-2xx", async () => {
      const fetchMock = vi.fn(
        async () => new Response("rate limit reached", { status: 429 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        postProviderChat({
          url: "https://api.openai.com/v1/chat/completions",
          body: { model: "gpt-4o" },
          headers: { Authorization: "Bearer sk-test" },
        }),
      ).rejects.toThrow("AI 请求失败 (429): rate limit reached");
    });

    it("falls back to Unknown error when error body cannot be read", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("cannot read body");
        },
      }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        postProviderChat({
          url: "https://api.openai.com/v1/chat/completions",
          body: { model: "gpt-4o" },
        }),
      ).rejects.toThrow("AI 请求失败 (500): Unknown error");
    });

    it("still applies Content-Type when caller passes no headers", async () => {
      const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await postProviderChat({
        url: "https://api.example.com/v1/chat/completions",
        body: { hello: "world" },
      });

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });
  });
});
