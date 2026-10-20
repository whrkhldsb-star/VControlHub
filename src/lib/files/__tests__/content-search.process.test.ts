// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Content search against real directories and a real symlink. LOCAL nodes use
 * the real filesystem walk; for SFTP nodes the generated remote command is run
 * by a local `sh` instead of over SSH, so the real grep/cd/pwd chain decides
 * what is searched. Nothing outside the temp directories is read.
 */
const hoisted = vi.hoisted(() => ({ nodes: [] as Array<{ id: string; name: string; driver: string; basePath: string }> }));

vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: {
      findMany: vi.fn(async () => hoisted.nodes),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const node = hoisted.nodes.find((candidate) => candidate.id === where.id);
        // An Agent-managed server: commands go through the Agent, no SSH key needed.
        return node ? {
          ...node, host: null, port: null, username: null, hostKeySha256: null,
          server: { id: "srv", operatingSystem: "LINUX", host: "sftp.test", port: 22, username: "files", connectionType: "SSH_KEY", managementMode: "AGENT", password: null, hostKeySha256: null, sshKey: null },
        } : null;
      }),
    },
    fileEntry: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/ssh/client", () => ({
  execRemoteCommand: vi.fn(async ({ command }: { command: string }) => {
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 20_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
  }),
}));

import { searchFileContents } from "../content-search";

const hasGrep = process.platform !== "win32" && spawnSync("sh", ["-c", "command -v grep"]).status === 0;

describe.skipIf(!hasGrep)("content search roots and symlinks (real files)", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "vch-content-search-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(root, "docs", "inside.txt"), "needle inside the node\n");
    writeFileSync(join(outside, "secret.txt"), "needle OUTSIDE the node\n");
    symlinkSync(outside, join(root, "docs", "link"));
    symlinkSync(root, join(base, "root-alias"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const search = async (driver: "LOCAL" | "SFTP", searchPath?: string, basePath = root) => {
    hoisted.nodes = [{ id: `n-${driver}`, name: driver, driver, basePath }];
    const response = await searchFileContents({ query: "needle", searchPath });
    return response.results.map((result) => ({ path: result.relativePath, snippets: result.snippets }));
  };

  it("LOCAL: the default whole-node search (no path) finds files", async () => {
    expect(await search("LOCAL")).toEqual([{ path: "docs/inside.txt", snippets: ["needle inside the node"] }]);
  });

  it("LOCAL: a sub-path still works and a symlinked sub-path out of the node is refused", async () => {
    expect((await search("LOCAL", "docs")).map((result) => result.path)).toEqual(["docs/inside.txt"]);
    expect(await search("LOCAL", "docs/link")).toEqual([]);
  });

  it("SFTP: a search path that is a link out of the node returns nothing from outside", async () => {
    const results = await search("SFTP", "docs/link");
    expect(results.flatMap((result) => result.snippets).join("\n")).not.toContain("OUTSIDE");
    expect(results).toEqual([]);
  });

  it("SFTP: whole-node and sub-path searches work, also when the node root itself is a symlink", async () => {
    expect((await search("SFTP")).map((result) => result.path)).toEqual(["docs/inside.txt"]);
    expect((await search("SFTP", "docs")).map((result) => result.path)).toEqual(["docs/inside.txt"]);
    expect((await search("SFTP", "", join(base, "root-alias"))).map((result) => result.path)).toEqual(["docs/inside.txt"]);
  });

  it("says the results are incomplete when a node has more matches than the cap", async () => {
    // 101 matching files: 100 were returned with truncated=false.
    const many = join(base, "many");
    mkdirSync(many);
    for (let i = 0; i < 101; i += 1) writeFileSync(join(many, `f${String(i).padStart(3, "0")}.txt`), "needle\n");
    for (const driver of ["LOCAL", "SFTP"] as const) {
      hoisted.nodes = [{ id: `n-${driver}`, name: driver, driver, basePath: many }];
      const response = await searchFileContents({ query: "needle" });
      expect(response.results).toHaveLength(100);
      expect(response.truncated).toBe(true);
    }
    // Exactly at the cap is complete.
    rmSync(join(many, "f100.txt"));
    for (const driver of ["LOCAL", "SFTP"] as const) {
      hoisted.nodes = [{ id: `n-${driver}`, name: driver, driver, basePath: many }];
      const response = await searchFileContents({ query: "needle" });
      expect(response.results).toHaveLength(100);
      expect(response.truncated).toBe(false);
    }
  });

  it("returns every listed SFTP match with its snippets, not only the first 20", async () => {
    const some = join(base, "some");
    mkdirSync(some);
    for (let i = 0; i < 21; i += 1) writeFileSync(join(some, `g${i}.txt`), `line needle ${i}\n`);
    hoisted.nodes = [{ id: "n-SFTP", name: "SFTP", driver: "SFTP", basePath: some }];
    const response = await searchFileContents({ query: "needle" });
    expect(response.results).toHaveLength(21);
    expect(response.results.every((result) => result.snippets.length === 1)).toBe(true);
  });
});

