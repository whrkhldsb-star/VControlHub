/**
 * TR-017: ai-client 拆分 - useModelCapabilities 纯逻辑单测
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ai-file-helpers", () => ({
  detectCapabilities: (id: string) => {
    if (id.includes("vision") || id.includes("gpt-4o") || id.includes("claude-3") || id.includes("gemini") || id.includes("qwen-vl"))
      return { vision: true, document: false, video: false, audio: false };
    return { vision: false, document: false, video: false, audio: false };
  },
}));

import { useModelCapabilities } from "../hooks/use-model-capabilities";

const SERVER_MODEL = {
  id: "gpt-4o-server",
  name: "GPT-4o",
  capabilities: { vision: true, document: true, video: false, audio: false },
};

describe("useModelCapabilities", () => {
  it("returns empty caps when modelId is null", () => {
    const { result } = renderHook(() => useModelCapabilities(null, []));
    expect(result.current.caps).toEqual({ vision: false, document: false, video: false, audio: false });
    expect(result.current.supportsVision).toBe(false);
  });

  it("prefers server-reported capabilities from modelList", () => {
    const { result } = renderHook(() => useModelCapabilities("gpt-4o-server", [SERVER_MODEL]));
    expect(result.current.caps).toEqual(SERVER_MODEL.capabilities);
    expect(result.current.supportsVision).toBe(true);
  });

  it("falls back to client-side detectCapabilities when server list lacks the model", () => {
    const { result } = renderHook(() => useModelCapabilities("gpt-4o", []));
    expect(result.current.caps.vision).toBe(true);
    expect(result.current.supportsVision).toBe(true);
  });

  it("supportsVision stays false for plain text models", () => {
    const { result } = renderHook(() => useModelCapabilities("gpt-3.5-turbo", []));
    expect(result.current.caps.vision).toBe(false);
    expect(result.current.supportsVision).toBe(false);
  });

  it("supportsVision is true when caps.vision is true even if name doesn't match hint", () => {
    const odd = {
      id: "weird-vision",
      name: "weird",
      capabilities: { vision: true, document: false, video: false, audio: false },
    };
    const { result } = renderHook(() => useModelCapabilities("weird-vision", [odd]));
    expect(result.current.supportsVision).toBe(true);
  });
});
