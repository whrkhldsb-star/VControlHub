import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {}, isUniqueViolation: () => false }));
vi.mock("@/lib/crypto/service", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => {
    if (value === "encrypted:damaged") throw new Error("Unsupported state or unable to authenticate data");
    return value.replace(/^encrypted:/, "");
  },
  isEncrypted: (value: string) => value.startsWith("encrypted:"),
}));
vi.mock("@/lib/runtime-settings/service", () => ({
  getAiProviderListLimit: async () => 50,
  getAiConversationListLimit: async () => 50,
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ lockForTransaction: async () => undefined }));

import { BusinessError } from "@/lib/errors";
import { safeDecryptApiKey } from "../service-crud";

describe("the provider API key as sent to the provider", () => {
  it("is the decrypted key, or the stored value when it was never encrypted", () => {
    expect(safeDecryptApiKey("encrypted:sk-live")).toBe("sk-live");
    expect(safeDecryptApiKey("sk-plain")).toBe("sk-plain");
  });

  it("is an error when the stored key cannot be decrypted, never the ciphertext", () => {
    // The ciphertext used to go out as the API key: a request with a nonsense credential to a third party.
    expect(() => safeDecryptApiKey("encrypted:damaged")).toThrow(BusinessError);
  });
});
