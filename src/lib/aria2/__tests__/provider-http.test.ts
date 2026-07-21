import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aria2HttpErrorMessage,
  aria2RpcErrorMessage,
  postAria2Rpc,
} from "../provider-http";

describe("aria2 provider-http adapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("postAria2Rpc", () => {
    const req = {
      url: "http://127.0.0.1:6800/jsonrpc",
      method: "aria2.addUri",
      params: [["magnet:?xt=urn:btih:abc"], { dir: "/srv/d" }],
      secret: "custom-token",
    };

    it("POSTs a JSON-RPC envelope with the token-prefixed secret and returns data.result on 2xx", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: "gid-123" }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await postAria2Rpc(req);

      expect(result).toBe("gid-123");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:6800/jsonrpc");
      expect(init.method).toBe("POST");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.jsonrpc).toBe("2.0");
      expect(typeof body.id).toBe("string");
      expect(body.method).toBe("aria2.addUri");
      expect(body.params).toEqual(["token:custom-token", ["magnet:?xt=urn:btih:abc"], { dir: "/srv/d" }]);
    });

    it("throws the RPC-error formatter when the response body contains a JSON-RPC error", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: "x", error: { code: 1, message: "Unauthorized" } }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow("Aria2 RPC error: Unauthorized");
    });

    it("falls back to JSON.stringify when the RPC error has no message field", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", error: { code: 1 } }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow(/Aria2 RPC error: /);
    });

    it("throws the HTTP-error formatter on a non-2xx response with truncated body", async () => {
      const fetchMock = vi.fn(async () => new Response("connection refused", { status: 502 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow("Aria2 RPC request failed (502): connection refused");
    });

    it("falls back to 'Unknown error' when the non-2xx body is empty", async () => {
      const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow("Aria2 RPC request failed (500): Unknown error");
    });

    it("truncates a long non-2xx body to 500 chars in the error message", async () => {
      const long = "x".repeat(800);
      const fetchMock = vi.fn(async () => new Response(long, { status: 500 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        await postAria2Rpc(req);
        throw new Error("expected postAria2Rpc to throw");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("Aria2 RPC request failed (500): ");
        expect(message.endsWith("x")).toBe(true);
        expect(message.length).toBe("Aria2 RPC request failed (500): ".length + 500);
      }
    });

    it("rejects a malformed JSON body on 2xx instead of creating a false-success task", async () => {
      const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow("Aria2 RPC returned an invalid JSON response");
    });

    it("rejects a JSON-RPC envelope that contains neither result nor error", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "x" }), { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(postAria2Rpc(req)).rejects.toThrow("Aria2 RPC response is missing result");
    });
  });

  describe("aria2HttpErrorMessage", () => {
    it("formats the status code and a trimmed body", () => {
      expect(aria2HttpErrorMessage(502, "  connection refused  ")).toBe(
        "Aria2 RPC request failed (502): connection refused",
      );
    });

    it("falls back to 'Unknown error' when body is empty or whitespace", () => {
      expect(aria2HttpErrorMessage(500, "")).toBe("Aria2 RPC request failed (500): Unknown error");
      expect(aria2HttpErrorMessage(500, "   ")).toBe("Aria2 RPC request failed (500): Unknown error");
    });

    it("truncates the body to 500 chars", () => {
      const long = "y".repeat(1000);
      const message = aria2HttpErrorMessage(500, long);
      expect(message).toBe("Aria2 RPC request failed (500): " + "y".repeat(500));
    });
  });

  describe("aria2RpcErrorMessage", () => {
    it("uses the error.message when present", () => {
      expect(aria2RpcErrorMessage({ code: 1, message: "Unauthorized" })).toBe(
        "Aria2 RPC error: Unauthorized",
      );
    });

    it("falls back to JSON.stringify(error) when message is absent", () => {
      expect(aria2RpcErrorMessage({ code: 1 })).toBe("Aria2 RPC error: " + JSON.stringify({ code: 1 }));
    });

    it("uses JSON.stringify(error) when message is empty string", () => {
      expect(aria2RpcErrorMessage({ code: 1, message: "" })).toBe(
        "Aria2 RPC error: " + JSON.stringify({ code: 1, message: "" }),
      );
    });
  });
});
