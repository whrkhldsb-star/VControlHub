import { describe, expect, it } from "vitest";
import { getParentPath, splitPath } from "../files-browser-helpers";

describe("getParentPath", () => {
  it("returns null at root", () => {
    expect(getParentPath("")).toBeNull();
    expect(getParentPath("/")).toBeNull();
  });

  it("returns empty string for single segment", () => {
    expect(getParentPath("photos")).toBe("");
    expect(getParentPath("/photos/")).toBe("");
  });

  it("returns parent path for nested folders", () => {
    expect(getParentPath("photos/raw")).toBe("photos");
    expect(getParentPath("a/b/c")).toBe("a/b");
  });
});

describe("splitPath", () => {
  it("filters empty segments", () => {
    expect(splitPath("/a//b/")).toEqual(["a", "b"]);
  });
});
