import { describe, expect, it, vi } from "vitest";

const { execRemoteCommandMock } = vi.hoisted(() => ({
  execRemoteCommandMock: vi.fn(),
}));

vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  execRemoteCommand: execRemoteCommandMock,
}));

import { downloadRestrictedFile } from "../restricted-download";
import { isInsideRoot } from "../sftp-root";

describe("Windows SFTP path casing (R5-02-07)", () => {
  it("compares Windows roots case-insensitively while keeping Linux roots case-sensitive", () => {
    expect(isInsideRoot("/C:/Users/Ops/file.txt", "/c:/users/ops", true)).toBe(true);
    expect(isInsideRoot("c:\\Users\\ops\\sub\\file.txt", "/C:/Users/Ops", true)).toBe(true);
    expect(isInsideRoot("/c:/users/ops", "/C:/Users/Ops", true)).toBe(true);
    expect(isInsideRoot("/C:/Users/Ops-Other/file.txt", "/c:/users/ops", true)).toBe(false);

    expect(isInsideRoot("/home/Alice/file.txt", "/home/alice", false)).toBe(false);
    expect(isInsideRoot("/home/alice/file.txt", "/home/alice", false)).toBe(true);
  });

  it("uses OrdinalIgnoreCase in windowsReader for GetFinalPathNameByHandle root checks", async () => {
    execRemoteCommandMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: `4\n${Buffer.from("data").toString("base64")}\n`,
    });

    await downloadRestrictedFile(
      {
        host: "10.0.0.5",
        port: 22,
        username: "ops",
        hostKeySha256: "SHA256:test",
        agentServerId: "srv_win",
      },
      { path: "/c:/users/ops", windows: true },
      "/c:/users/ops/report.txt",
    );

    const command = execRemoteCommandMock.mock.calls[0]![0].command as string;
    const encoded = command.split(" ").at(-1)!;
    const decoded = Buffer.from(encoded, "base64").toString("utf16le");
    expect(decoded).toContain("[StringComparison]::OrdinalIgnoreCase");
    expect(decoded).not.toContain("[StringComparison]::Ordinal)");
  });
});
