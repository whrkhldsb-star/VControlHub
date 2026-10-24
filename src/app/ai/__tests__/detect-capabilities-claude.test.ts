import { describe, expect, it } from "vitest";

import { detectCapabilities } from "../ai-file-helpers";

/**
 * Current Claude ids put the family first ("claude-sonnet-4-5"); the list only
 * knew "claude-3"/"claude-4", so images and PDFs were refused for them.
 */
describe("client capability detection of current Claude ids", () => {
  it.each(["claude-sonnet-4-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"])("%s takes images and PDFs", (model) => {
    expect(detectCapabilities(model)).toMatchObject({ vision: true, document: true });
  });

  it("keeps the original Claude 3 models image-only", () => {
    expect(detectCapabilities("claude-3-haiku-20240307")).toMatchObject({ vision: true, document: false });
  });
});
