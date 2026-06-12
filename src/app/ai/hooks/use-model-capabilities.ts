"use client";

/**
 * useModelCapabilities
 *
 * Resolves a model's effective capabilities by first looking at the
 * server-reported list (preferred) and falling back to client-side name
 * detection for older / non-enumerated models.
 *
 * TR-017 (ai-client 拆分)
 */
import { useMemo } from "react";
import type { ModelCapabilities, ModelInfo } from "../ai-types";
import { detectCapabilities } from "../ai-file-helpers";

const EMPTY_CAPS: ModelCapabilities = {
  vision: false,
  document: false,
  video: false,
  audio: false,
};

const VISION_NAME_HINT = /gpt-4o|claude-3|gemini|qwen-vl/i;

export function useModelCapabilities(
  modelId: string | null | undefined,
  modelList: ModelInfo[]
): { caps: ModelCapabilities; supportsVision: boolean } {
  return useMemo(() => {
    if (!modelId) return { caps: EMPTY_CAPS, supportsVision: false };
    const serverModel = modelList.find((m) => m.id === modelId);
    const caps = serverModel?.capabilities ?? detectCapabilities(modelId);
    const supportsVision = !!caps.vision || VISION_NAME_HINT.test(modelId);
    return { caps, supportsVision };
  }, [modelId, modelList]);
}
