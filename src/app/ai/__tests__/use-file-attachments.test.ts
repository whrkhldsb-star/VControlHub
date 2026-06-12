/**
 * TR-017: ai-client 拆分 - useFileAttachments 纯逻辑单测
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom's FileReader doesn't fully implement blob/dataURL reading; mock the
// helpers to return deterministic test fixtures.
vi.mock("../ai-file-helpers", () => ({
  categorizeFile: (file: File) => {
    if (file.type.startsWith("image/")) return "image" as const;
    if (file.type.startsWith("video/")) return "video" as const;
    if (file.type.startsWith("audio/")) return "audio" as const;
    if (file.type === "application/pdf") return "document" as const;
    if (file.type.startsWith("text/") || file.name.endsWith(".txt")) return "text" as const;
    return "unknown" as const;
  },
  readFileAsDataURL: (file: File) => Promise.resolve(`data:${file.type};base64,BASE64_${file.name}`),
  readFileAsText: async (file: File) => {
    // text/plain files built via new File([string]) keep their string content.
    // We mirror that by reading the first part's character payload when present.
    // For deterministic tests we return a long string for files larger than 100kB.
    if (file.size > 100 * 1024) return "a".repeat(150000);
    return `text-content-of-${file.name}`;
  },
  formatAllowedTypes: () => "image, text",
  isTextFile: (file: File) => file.type.startsWith("text/") || file.name.endsWith(".txt"),
  buildAcceptString: () => "",
  detectCapabilities: () => ({ vision: false, document: false, video: false, audio: false }),
}));

import { useFileAttachments } from "../hooks/use-file-attachments";

const ALL_CAPS = {
  vision: true,
  document: true,
  video: true,
  audio: true,
} as const;

function makeFile(name: string, type: string, size = 1024, content = "data"): File {
  const file = new File([new Uint8Array(size)], name, { type });
  // jsdom doesn't implement File.text() reliably; provide arrayBuffer support
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(content),
  });
  return file;
}

describe("useFileAttachments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects files larger than 20MB", async () => {
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: ALL_CAPS,
        modelName: "gpt-4o",
        onReject,
      })
    );
    const big = makeFile("big.bin", "application/octet-stream", 21 * 1024 * 1024);
    await act(async () => {
      await result.current.handleFileSelect([big]);
    });
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/20MB/));
    expect(result.current.fileAttachments).toHaveLength(0);
  });

  it("rejects image when vision is not supported and enableVision is false", async () => {
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: false, document: true, video: true, audio: true },
        modelName: "gpt-3.5",
        enableVision: false,
        onReject,
      })
    );
    const img = makeFile("a.png", "image/png");
    await act(async () => {
      await result.current.handleFileSelect([img]);
    });
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/不支持图片输入/));
    expect(result.current.fileAttachments).toHaveLength(0);
  });

  it("accepts image when vision is enabled or model supports vision", async () => {
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: ALL_CAPS,
        modelName: "gpt-4o",
      })
    );
    const img = makeFile("a.png", "image/png");
    await act(async () => {
      await result.current.handleFileSelect([img]);
    });
    expect(result.current.fileAttachments).toHaveLength(1);
    expect(result.current.fileAttachments[0].type).toBe("image");
    expect(result.current.fileAttachments[0].mimeType).toBe("image/png");
  });

  it("accepts image via enableVision even when model doesn't support vision", async () => {
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: false, document: true, video: true, audio: true },
        modelName: "text-only",
        enableVision: true,
      })
    );
    const img = makeFile("a.png", "image/png");
    await act(async () => {
      await result.current.handleFileSelect([img]);
    });
    expect(result.current.fileAttachments).toHaveLength(1);
  });

  it("rejects video when model lacks video support", async () => {
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: true, document: true, video: false, audio: true },
        modelName: "no-video",
        onReject,
      })
    );
    await act(async () => {
      await result.current.handleFileSelect([makeFile("a.mp4", "video/mp4")]);
    });
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/不支持视频输入/));
  });

  it("rejects audio when model lacks audio support", async () => {
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: true, document: true, video: true, audio: false },
        modelName: "no-audio",
        onReject,
      })
    );
    await act(async () => {
      await result.current.handleFileSelect([makeFile("a.mp3", "audio/mpeg")]);
    });
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/不支持音频输入/));
  });

  it("rejects PDF document when model lacks document support", async () => {
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: true, document: false, video: true, audio: true },
        modelName: "no-doc",
        onReject,
      })
    );
    await act(async () => {
      await result.current.handleFileSelect([makeFile("a.pdf", "application/pdf")]);
    });
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/不支持 PDF/));
  });

  it("accepts text file and truncates long content", async () => {
    const longContent = "a".repeat(150000);
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: ALL_CAPS,
        modelName: "any",
      })
    );
    const txt = new File([longContent], "long.txt", { type: "text/plain" });
    await act(async () => {
      await result.current.handleFileSelect([txt]);
    });
    expect(result.current.fileAttachments).toHaveLength(1);
    expect(result.current.fileAttachments[0].type).toBe("text");
    expect(result.current.fileAttachments[0].content.length).toBeGreaterThan(100000);
    expect(result.current.fileAttachments[0].content).toMatch(/已截断/);
  });

  it("clearAttachments empties the list", async () => {
    const { result } = renderHook(() =>
      useFileAttachments({ currentModelCaps: ALL_CAPS, modelName: "x" })
    );
    await act(async () => {
      await result.current.handleFileSelect([makeFile("a.txt", "text/plain")]);
    });
    expect(result.current.fileAttachments).toHaveLength(1);
    act(() => result.current.clearAttachments());
    expect(result.current.fileAttachments).toHaveLength(0);
  });

  it("auto-clears rejection message after 4s", async () => {
    vi.useRealTimers();
    const onReject = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments({
        currentModelCaps: { vision: false, document: true, video: true, audio: true },
        modelName: "x",
        enableVision: false,
        onReject,
      })
    );
    await act(async () => {
      await result.current.handleFileSelect([makeFile("a.png", "image/png")]);
    });
    expect(result.current.fileRejectionMsg).not.toBeNull();
    await waitFor(
      () => expect(result.current.fileRejectionMsg).toBeNull(),
      { timeout: 6000 }
    );
  });
});
