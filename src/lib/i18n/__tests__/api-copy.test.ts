import { describe, expect, it } from "vitest";
import { apiCopy, en, localizeApiCopy, withApiCopyLocale } from "../api-copy";

describe("API copy locale boundary", () => {
  it("keeps stable English for workers and translates request-scoped copy", () => {
    const key = Object.keys(en).find((name) => en[name as keyof typeof en] === "Operation failed");
    expect(key).toBeTruthy();
    const english = apiCopy(key!);
    expect(english).toMatch(/Operation failed/);
    expect(withApiCopyLocale("zh", () => apiCopy(key!))).toMatch(/失败/);
    expect(localizeApiCopy(english, "zh")).toMatch(/失败/);
  });
});
