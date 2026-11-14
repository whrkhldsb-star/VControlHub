import { describe, expect, it } from "vitest";
import { apiCopy, en, localizeApiCopy, setBackgroundCopyLocale, withApiCopyLocale } from "../api-copy";

describe("API copy locale boundary", () => {
  it("keeps stable English for workers and translates request-scoped copy", () => {
    const key = Object.keys(en).find((name) => en[name as keyof typeof en] === "Operation failed");
    expect(key).toBeTruthy();
    const english = apiCopy(key!);
    expect(english).toMatch(/Operation failed/);
    expect(withApiCopyLocale("zh", () => apiCopy(key!))).toMatch(/失败/);
    expect(localizeApiCopy(english, "zh")).toMatch(/失败/);
  });

  it("words copy outside a request in the process's language once one is set", () => {
    // The worker: its job errors were English on a Chinese-default platform.
    const key = Object.keys(en).find((name) => en[name as keyof typeof en] === "Operation failed")!;
    setBackgroundCopyLocale("zh");
    try {
      expect(apiCopy(key)).toMatch(/失败/);
      // A request still speaks its own language.
      expect(withApiCopyLocale("en", () => apiCopy(key))).toBe("Operation failed");
      // A route's fallback text is mapped for the viewer, never for the process.
      expect(localizeApiCopy("Operation failed")).toBe("Operation failed");
    } finally {
      setBackgroundCopyLocale(undefined);
    }
    expect(apiCopy(key)).toBe("Operation failed");
  });

  it("says a count in English with the noun's form for it, and still maps it back for a Chinese viewer", () => {
    expect(apiCopy("apiCopy.archive.extracted", { v0: 1, v1: "docs" })).toBe("Extracted 1 file into the folder “docs”");
    expect(apiCopy("apiCopy.archive.extracted", { v0: 3, v1: "docs" })).toBe("Extracted 3 files into the folder “docs”");
    expect(localizeApiCopy("Extracted 1 file into the folder “docs”", "zh")).toBe("已解压 1 个文件到文件夹“docs”");
    expect(localizeApiCopy("Extracted 3 files into the folder “docs”", "zh")).toBe("已解压 3 个文件到文件夹“docs”");
  });
});
