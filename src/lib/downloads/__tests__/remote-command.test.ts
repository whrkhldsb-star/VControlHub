import { describe, expect, it } from "vitest";

import { buildDirectDownloadCommand, shellQuote, toScpTarget } from "@/lib/downloads/remote-command";

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
    });

    expect(command).toContain("output_path='\\''/srv/cloud/custom name.iso'\\''");
    expect(command).toContain("wget --max-redirect=3 -O \"$output_path\" \"$download_url\"");
    expect(command).toContain("curl -L --max-redirs 3 --proto-redir =https,http -o \"$output_path\" \"$download_url\"");
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
