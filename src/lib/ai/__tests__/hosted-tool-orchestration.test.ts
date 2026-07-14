import { describe, expect, it } from "vitest";

import { buildCommand } from "../hosted-command-builder";
import { HOSTED_TOOLS } from "../hosted-tools";

describe("AI hosted file and Docker tools", () => {
  it("registers all cross-module read tools", () => {
    const types = new Set(HOSTED_TOOLS.map((tool) => tool.actionType));
    for (const type of ["list_files", "search_files", "read_file", "get_docker_logs"]) {
      expect(types.has(type as never)).toBe(true);
    }
  });

  it("builds safe file listing and search commands", () => {
    expect(buildCommand("list_files", { path: "/var/log" })).toContain("find '/var/log'");
    expect(buildCommand("search_files", { path: "/var/log", query: "error", filePattern: "*.log" })).toContain("grep -rFInI");
    expect(buildCommand("read_file", { filePath: "/etc/hosts", tail: 20 })).toBe("tail -n 20 -- '/etc/hosts'");
  });

  it("rejects traversal, unsafe patterns, and unsafe container identifiers", () => {
    expect(buildCommand("list_files", { path: "/var/../etc" })).toBeNull();
    expect(buildCommand("search_files", { path: "/var/log", query: "x\nrm", filePattern: "*.log" })).toBeNull();
    expect(buildCommand("search_files", { path: "/var/log", query: "x", filePattern: "*.log;rm" })).toBeNull();
    expect(buildCommand("get_docker_logs", { containerId: "x;rm", tail: 20 })).toBeNull();
  });

  it("caps tail values", () => {
    expect(buildCommand("read_file", { filePath: "/etc/hosts", tail: 1001 })).toBeNull();
    expect(buildCommand("get_docker_logs", { containerId: "web-1", tail: 100 })).toContain("docker logs --tail 100");
  });
});
