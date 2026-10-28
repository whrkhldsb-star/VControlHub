import { describe, expect, it } from "vitest";

import { buildDirectDownloadCommand, shellQuote, toScpTarget } from "@/lib/downloads/remote-command";

const sourceResolution = {
  hostname: "example.com",
  address: "93.184.216.34",
  port: 443 as const,
};

describe("download remote command helpers", () => {
  it("quotes arbitrary values as a single POSIX shell token", () => {
    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("a'b c; rm -rf /")).toBe("'a'\\''b c; rm -rf /'");
  });

  it("builds a bash -lc direct download command without embedding a raw single-quoted script", () => {
    const command = buildDirectDownloadCommand({
      taskId: "task-1",
      url: "https://example.com/file's name.iso?x=$(uname)",
      targetPath: "/srv/cloud/path with spaces/it's safe",
      fileName: null,
      sourceResolution,
    });

    expect(command).toContain("nohup bash -lc '");
    expect(command).toContain("download_url='");
    expect(command).toContain("target_dir='");
    expect(command).toContain("${download_url%%[?#]*}");
    expect(command).not.toContain("bash -c '\nif command");
    expect(command).not.toContain("`uname`");
  });

  it("uses an explicit output path when fileName is provided", () => {
    const command = buildDirectDownloadCommand({
      taskId: "task-2",
      url: "https://example.com/a.iso",
      targetPath: "/srv/cloud",
      fileName: "custom name.iso",
      sourceResolution,
    });

    expect(command).toContain("output_path='\\''/srv/cloud/custom name.iso'\\''");
    expect(command).toContain("--max-redirs 0");
    expect(command).toContain("--resolve \"$resolve_entry\"");
    expect(command).not.toContain("wget ");
  });

  it("applies the task's speed limit to curl, and no limit when there is none", () => {
    // The form offers "KB/s" for every download; only magnet (aria2) downloads used to honour it.
    const base = { taskId: "task-3", url: "https://example.com/a.iso", targetPath: "/srv/cloud", fileName: null, sourceResolution };
    expect(buildDirectDownloadCommand({ ...base, maxSpeedKb: 512 })).toContain("limit_rate=512k");
    expect(buildDirectDownloadCommand({ ...base, maxSpeedKb: 512 })).toContain('${limit_rate:+--limit-rate \"$limit_rate\"}');
    expect(buildDirectDownloadCommand(base)).toContain("limit_rate=\n");
    expect(buildDirectDownloadCommand({ ...base, maxSpeedKb: 0 })).toContain("limit_rate=\n");
  });

  it("builds an scp target with brackets for IPv6 hosts", () => {
    expect(toScpTarget("root", "2001:db8::1", "/srv/a file.txt")).toBe(
      "root@[2001:db8::1]:/srv/a file.txt",
    );
    expect(toScpTarget("root", "example.com", "/srv/a file.txt")).toBe(
      "root@example.com:/srv/a file.txt",
    );
  });
});
