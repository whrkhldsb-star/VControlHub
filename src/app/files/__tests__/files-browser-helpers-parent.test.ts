import { describe, expect, it } from "vitest";
import {
  getParentPath,
  splitPath,
  treePathMatchesCurrentPath,
} from "../files-browser-helpers";

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

describe("treePathMatchesCurrentPath", () => {
  it("matches exact paths only", () => {
    expect(treePathMatchesCurrentPath("docs", "docs")).toBe(true);
    expect(treePathMatchesCurrentPath("/docs/", "docs")).toBe(true);
    expect(treePathMatchesCurrentPath("archive/docs", "archive/docs")).toBe(true);
  });

  it("does not treat path suffixes as matches", () => {
    // previous endsWith(`/${current}`) falsely expanded archive/docs when browsing docs
    expect(treePathMatchesCurrentPath("archive/docs", "docs")).toBe(false);
    expect(treePathMatchesCurrentPath("docs/extra", "docs")).toBe(false);
  });

  it("returns false for empty current path", () => {
    expect(treePathMatchesCurrentPath("docs", "")).toBe(false);
  });
});
