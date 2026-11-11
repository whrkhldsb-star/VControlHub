import { describe, expect, it } from "vitest";
import {
  getCurrentPathDisplay,
  getParentPath,
  getPathGroupNode,
  resolveBrowserLocation,
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

describe("paths that name a node", () => {
  const t = (key: string) => key;
  const nodes = [
    { id: "cmps1rmyabcdef", name: "东京 VPS", driver: "SFTP" },
    { id: "node_local_default", name: "本机__备用", driver: "LOCAL" },
  ];

  it("reads a node only from the first segment of the all-locations view", () => {
    // Every segment used to be split at "__": a folder named __pycache__ had an empty name in the breadcrumbs and
    // in the page title, and my__notes was shown as "my".
    expect(getPathGroupNode(nodes, "东京 VPS__cmps1rmy/app/__pycache__", "")?.id).toBe("cmps1rmyabcdef");
    expect(getPathGroupNode(nodes, "app/__pycache__", "cmps1rmyabcdef")).toBeNull();
    expect(getPathGroupNode(nodes, "", "")).toBeNull();
    expect(getPathGroupNode(nodes, "__pycache__", "")).toBeNull();

    expect(getCurrentPathDisplay(t, "东京 VPS__cmps1rmy/app/__pycache__", nodes, "")).toEqual({
      title: "东京 VPS",
      label: "东京 VPS (SFTP): /app/__pycache__",
      uploadPathLabel: "/app/__pycache__",
    });
    expect(getCurrentPathDisplay(t, "app/my__notes", nodes, "cmps1rmyabcdef")).toEqual({
      title: "东京 VPS",
      label: "东京 VPS (SFTP): /app/my__notes",
      uploadPathLabel: "/app/my__notes",
    });
  });

  it("finds a node whose own name holds the separator", () => {
    // "本机__备用__node_loc" was split into the label "本机" and the id prefix "备用": no node, so a new folder or an
    // upload from inside it asked which node to use.
    expect(getPathGroupNode(nodes, "本机__备用__node_loc/docs", "")?.id).toBe("node_local_default");
    expect(resolveBrowserLocation(nodes, "本机__备用__node_loc/docs/__tests__", "")).toEqual({ nodeId: "node_local_default", relativePath: "docs/__tests__" });
    expect(resolveBrowserLocation(nodes, "docs/__tests__", "cmps1rmyabcdef")).toEqual({ nodeId: "cmps1rmyabcdef", relativePath: "docs/__tests__" });
    expect(resolveBrowserLocation(nodes, "", "")).toEqual({ nodeId: "", relativePath: "" });
  });

  it("still knows a node by the start of its id when the name in the path is an older one", () => {
    expect(getPathGroupNode(nodes, "旧名字__cmps1rmy/docs", "")?.id).toBe("cmps1rmyabcdef");
    // Two nodes created in the same instant share that start: then only the exact key decides.
    const twins = [{ id: "cmps1rmy0001", name: "A", driver: "SFTP" }, { id: "cmps1rmy0002", name: "B", driver: "SFTP" }];
    expect(getPathGroupNode(twins, "B__cmps1rmy/docs", "")?.id).toBe("cmps1rmy0002");
    expect(getPathGroupNode(twins, "旧名字__cmps1rmy/docs", "")).toBeNull();
  });
});
