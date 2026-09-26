import { describe, expect, it } from "vitest";
import {
  buildInstallWindowsDirectGatewayCommand,
  buildPrepareWindowsDirectGatewayCommand,
  buildUninstallWindowsDirectGatewayCommand,
  buildWindowsDirectGatewaySource,
  windowsSftpPathToNative,
} from "../windows-direct-gateway";

function decode(command: string) {
  return Buffer.from(command.split(" ").at(-1)!, "base64").toString("utf16le");
}

describe("Windows direct gateway command", () => {
  it("uses a drive-rooted OpenSSH path and rejects traversal or drive roots", () => {
    expect(windowsSftpPathToNative("/C:/VControlHub/Files")).toBe("C:\\VControlHub\\Files");
    expect(() => windowsSftpPathToNative("/C:/")).toThrow();
    expect(() => windowsSftpPathToNative("/C:/Files/../Windows")).toThrow();
    expect(() => windowsSftpPathToNative("/C:/Files:stream")).toThrow();
    expect(() => windowsSftpPathToNative("/C:/Files//nested")).toThrow();
  });

  it("installs a restricted signed file service and removes only its own task", () => {
    const source = buildWindowsDirectGatewaySource({ rootPath: "/C:/VControlHub/Files", secret: "test-secret", publicListen: true });
    const prepare = decode(buildPrepareWindowsDirectGatewayCommand());
    const install = decode(buildInstallWindowsDirectGatewayCommand({}));
    expect(source).toContain("C:\\VControlHub\\Files");
    expect(source).toContain("HMACSHA256");
    expect(source).toContain("ReparsePoint");
    expect(source).toContain("GetFinalPathNameByHandle");
    expect(source).toContain("Content-Range");
    expect(install).toContain("Register-ScheduledTask");
    expect(prepare).toContain("icacls.exe");
    expect(install).toContain("New-NetFirewallRule");
    expect(buildInstallWindowsDirectGatewayCommand({}).length).toBeLessThan(8191);

    const uninstall = decode(buildUninstallWindowsDirectGatewayCommand());
    expect(uninstall).toContain("Unregister-ScheduledTask");
    expect(uninstall).toContain("VControlHub\\direct-gateway");
    expect(uninstall).not.toContain("Remove-Item -LiteralPath $env:ProgramData");
  });
});
