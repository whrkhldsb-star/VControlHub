import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiRequest } from "../api-client";

describe("browser transport security and native bodies", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    document.cookie = "csrf_token=transport-token; path=/";
    fetchMock.mockReset().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    document.cookie = "csrf_token=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });
  it.each(["https://external.invalid/upload", "//external.invalid/upload", "https://localhost.evil.invalid/upload"])("never sends CSRF to %s", async (url) => {
    await api.post(url, {}, { headers: { "x-csrf-token": "explicit-token" } });
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).has("x-csrf-token")).toBe(false);
  });
  it("inherits Request method and headers for same-origin writes", async () => {
    const request = new Request(new URL("/api/upload", window.location.href), { method: "PUT", headers: { "x-upload": "yes" }, body: "bytes" });
    await apiRequest(request);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.method).toBe("PUT");
    expect(init.headers.get("x-upload")).toBe("yes");
    expect(init.headers.get("x-csrf-token")).toBe("transport-token");
    expect(init.redirect).toBe("error");
  });
  it.each([new ArrayBuffer(3), new Uint8Array([0, 128, 255]), new DataView(new ArrayBuffer(3)), new Blob(["bytes"])])("preserves native binary body %# and signal", async (body) => {
    const controller = new AbortController();
    await api.put("/api/upload", body, { signal: controller.signal, headers: { "Content-Type": "application/octet-stream" } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.body).toBe(body);
    expect(init.signal).toBe(controller.signal);
    expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init.headers.get("x-csrf-token")).toBe("transport-token");
  });
  it("preserves abort errors without wrapping them", async () => {
    const error = new DOMException("cancelled", "AbortError");
    fetchMock.mockRejectedValueOnce(error);
    await expect(api.get("/api/search")).rejects.toBe(error);
  });
});
