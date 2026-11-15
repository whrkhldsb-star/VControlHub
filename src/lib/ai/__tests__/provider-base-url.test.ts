// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeProviderBaseUrl } from "../service-crud";

/**
 * A provider's Base URL must name a public host (SSRF protection), so a local Ollama or LM Studio could not be
 * saved at all. The operator may list such hosts in AI_PROVIDER_PRIVATE_HOSTS; nothing else changes.
 */
describe("saving an AI provider's Base URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a private or loopback host nobody listed", () => {
    expect(() => normalizeProviderBaseUrl("http://192.168.1.20:11434/v1")).toThrow();
    expect(() => normalizeProviderBaseUrl("http://localhost:1234/v1")).toThrow();
  });

  it("accepts a private host the operator listed, with the usual scheme and credential rules", () => {
    vi.stubEnv("AI_PROVIDER_PRIVATE_HOSTS", "192.168.1.20,localhost");
    expect(normalizeProviderBaseUrl("http://192.168.1.20:11434/v1")).toBe("http://192.168.1.20:11434/v1");
    expect(normalizeProviderBaseUrl("http://localhost:1234/v1#models")).toBe("http://localhost:1234/v1");
    expect(() => normalizeProviderBaseUrl("ftp://192.168.1.20/v1")).toThrow();
    expect(() => normalizeProviderBaseUrl("http://user:pass@192.168.1.20/v1")).toThrow();
  });

  it("never accepts a link-local (cloud metadata) address, listed or not", () => {
    vi.stubEnv("AI_PROVIDER_PRIVATE_HOSTS", "169.254.169.254");
    expect(() => normalizeProviderBaseUrl("http://169.254.169.254/latest")).toThrow();
  });

  it("keeps public addresses as they were", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
    expect(normalizeProviderBaseUrl(undefined)).toBe("https://api.openai.com/v1");
  });
});
