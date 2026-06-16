import { describe, expect, it } from "vitest";

import {
  aiModelsQuerySchema,
  aiProviderTypeSchema,
  chatRequestSchema,
  createConversationSchema,
  createProviderSchema,
  hostedActionDecisionSchema,
  probeModelsSchema,
  updateConversationSchema,
  updateProviderSchema,
} from "../schema";

describe("aiProviderTypeSchema", () => {
  it("accepts the two wired-up provider types", () => {
    expect(aiProviderTypeSchema.parse("OPENAI_COMPATIBLE")).toBe(
      "OPENAI_COMPATIBLE",
    );
    expect(aiProviderTypeSchema.parse("ANTHROPIC")).toBe("ANTHROPIC");
  });

  it("rejects unknown types", () => {
    expect(aiProviderTypeSchema.safeParse("UNKNOWN").success).toBe(false);
  });
});

describe("createProviderSchema", () => {
  it("accepts a minimal payload", () => {
    const parsed = createProviderSchema.parse({ name: "OpenAI", apiKey: "x" });
    expect(parsed.name).toBe("OpenAI");
    expect(parsed.apiKey).toBe("x");
  });

  it("accepts optional fields", () => {
    const parsed = createProviderSchema.parse({
      name: "OpenAI",
      apiKey: "x",
      type: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      availableModels: ["gpt-4o", "gpt-4o-mini"],
      isDefault: true,
      enabled: false,
    });
    expect(parsed.availableModels).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("rejects empty apiKey / name", () => {
    expect(
      createProviderSchema.safeParse({ name: "", apiKey: "x" }).success,
    ).toBe(false);
    expect(
      createProviderSchema.safeParse({ name: "n", apiKey: "" }).success,
    ).toBe(false);
  });

  it("rejects oversized name", () => {
    expect(
      createProviderSchema.safeParse({
        name: "x".repeat(129),
        apiKey: "x",
      }).success,
    ).toBe(false);
  });
});

describe("updateProviderSchema", () => {
  it("accepts an empty object (no-op)", () => {
    expect(updateProviderSchema.parse({})).toEqual({});
  });

  it("rejects invalid type enum", () => {
    expect(
      updateProviderSchema.safeParse({ type: "GPT" }).success,
    ).toBe(false);
  });

  it("accepts partial updates", () => {
    const parsed = updateProviderSchema.parse({ enabled: false });
    expect(parsed.enabled).toBe(false);
  });
});

describe("createConversationSchema", () => {
  it("requires providerId and model", () => {
    expect(
      createConversationSchema.safeParse({ providerId: "p", model: "m" })
        .success,
    ).toBe(true);
    expect(
      createConversationSchema.safeParse({ providerId: "p" }).success,
    ).toBe(false);
  });

  it("clamps temperature / topP / penalties", () => {
    expect(
      createConversationSchema.safeParse({
        providerId: "p",
        model: "m",
        temperature: 3,
      }).success,
    ).toBe(false);
    expect(
      createConversationSchema.safeParse({
        providerId: "p",
        model: "m",
        topP: 1.5,
      }).success,
    ).toBe(false);
    expect(
      createConversationSchema.safeParse({
        providerId: "p",
        model: "m",
        frequencyPenalty: -3,
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer maxTokens", () => {
    expect(
      createConversationSchema.safeParse({
        providerId: "p",
        model: "m",
        maxTokens: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe("updateConversationSchema", () => {
  it("accepts empty object", () => {
    expect(updateConversationSchema.parse({})).toEqual({});
  });

  it("accepts clearMessages flag", () => {
    expect(
      updateConversationSchema.parse({ clearMessages: true }).clearMessages,
    ).toBe(true);
  });
});

describe("aiModelsQuerySchema", () => {
  it("rejects empty providerId", () => {
    expect(aiModelsQuerySchema.safeParse({ providerId: "" }).success).toBe(
      false,
    );
    expect(aiModelsQuerySchema.safeParse({ providerId: " " }).success).toBe(
      false,
    );
  });

  it("trims providerId", () => {
    expect(
      aiModelsQuerySchema.parse({ providerId: "  p  " }).providerId,
    ).toBe("p");
  });

  it("requires providerId to be present", () => {
    expect(aiModelsQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("probeModelsSchema", () => {
  it("requires apiKey", () => {
    expect(probeModelsSchema.safeParse({}).success).toBe(false);
    expect(probeModelsSchema.safeParse({ apiKey: "" }).success).toBe(false);
  });

  it("accepts baseUrl + defaultModel", () => {
    expect(
      probeModelsSchema.parse({
        apiKey: "k",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
      }).defaultModel,
    ).toBe("gpt-4o");
  });
});

describe("chatRequestSchema", () => {
  it("accepts minimal message-only payload", () => {
    expect(chatRequestSchema.parse({ message: "hi" }).message).toBe("hi");
  });

  it("rejects empty message", () => {
    expect(chatRequestSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("rejects too many images", () => {
    const images = Array.from({ length: 9 }, () => "https://example.com/a");
    expect(
      chatRequestSchema.safeParse({ message: "hi", imageUrls: images })
        .success,
    ).toBe(false);
  });

  it("accepts attachments", () => {
    expect(
      chatRequestSchema.parse({
        message: "hi",
        fileAttachments: [{ name: "a.txt", content: "abc" }],
      }).fileAttachments?.length,
    ).toBe(1);
  });
});

describe("hostedActionDecisionSchema", () => {
  it("accepts approve without reason", () => {
    expect(hostedActionDecisionSchema.parse({ action: "approve" })).toEqual({
      action: "approve",
      reason: undefined,
    });
  });

  it("requires reason on reject", () => {
    expect(
      hostedActionDecisionSchema.safeParse({ action: "reject" }).success,
    ).toBe(false);
    expect(
      hostedActionDecisionSchema.safeParse({ action: "reject", reason: "no" })
        .success,
    ).toBe(true);
  });

  it("rejects unknown action", () => {
    expect(
      hostedActionDecisionSchema.safeParse({ action: "skip" }).success,
    ).toBe(false);
  });
});
