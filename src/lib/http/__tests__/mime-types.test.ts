import { describe, it, expect } from "vitest";
import { guessContentType } from "../mime-types";

describe("guessContentType", () => {
  it("returns provided mimeType when given", () => {
    expect(guessContentType("foo.bin", "application/x-custom")).toBe("application/x-custom");
  });
  it("falls back to extension map when no mimeType", () => {
    expect(guessContentType("photo.JPG")).toBe("image/jpeg");
    expect(guessContentType("a.png")).toBe("image/png");
    expect(guessContentType("video.mkv")).toBe("video/x-matroska");
    expect(guessContentType("page.html")).toBe("text/html; charset=utf-8");
    expect(guessContentType("archive.7z")).toBe("application/x-7z-compressed");
  });
  it("returns octet-stream for unknown extensions", () => {
    expect(guessContentType("file.xyz")).toBe("application/octet-stream");
    expect(guessContentType("noext")).toBe("application/octet-stream");
  });
  it("ignores mimeType when null/empty", () => {
    expect(guessContentType("a.png", null)).toBe("image/png");
    expect(guessContentType("a.png", "")).toBe("image/png");
  });
});
