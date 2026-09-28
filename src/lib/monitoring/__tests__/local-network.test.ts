import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: execFileMock,
    default: { ...actual, execFile: execFileMock },
  };
});

vi.mock("@/lib/runtime/platform-paths", () => ({
  isWindows: () => true,
}));

describe("Windows local network sampling", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
  });

  it("samples asynchronously and shares one in-flight PowerShell process", async () => {
    let finish!: () => void;
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      finish = () => callback(
        null,
        "Ethernet\t1024\t2048\r\nvEthernet (Default Switch)\t4096\t8192\r\n",
        "",
      );
      return {};
    });

    const { readLocalNetworkDeviceStats } = await import("../local-network");
    const first = readLocalNetworkDeviceStats();
    const second = readLocalNetworkDeviceStats();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    finish();
    await expect(first).resolves.toEqual([
      { iface: "Ethernet", rxBytes: 1024, txBytes: 2048 },
      { iface: "vEthernet (Default Switch)", rxBytes: 4096, txBytes: 8192 },
    ]);
    await expect(second).resolves.toEqual(await first);
  });
});
