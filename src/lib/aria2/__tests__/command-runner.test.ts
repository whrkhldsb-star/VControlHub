import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const mockedModule = {
    ...actual,
    spawn: spawnMock,
  };
  return {
    __esModule: true,
    ...mockedModule,
    default: mockedModule,
  };
});

import {
  getMissingAria2BinaryMessage,
  isMissingAria2BinaryError,
  spawnAria2Detached,
} from "../command-runner";

const fakeProcess = () => Object.assign(new EventEmitter(), { unref: vi.fn() });

describe("aria2 command-runner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spawnAria2Detached", () => {
    it("forwards the args to spawn('aria2c', ...) with detached + stdio:'ignore' and returns the child", async () => {
      const fakeChild = fakeProcess();
      spawnMock.mockReturnValue(fakeChild);

      const child = spawnAria2Detached(["--conf-path=/tmp/x.conf"]);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [file, args, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(file).toBe("aria2c");
      expect(args).toEqual(["--conf-path=/tmp/x.conf"]);
      expect(opts).toEqual({ detached: true, stdio: "ignore" });
      fakeChild.emit("spawn");
      await expect(child).resolves.toBe(fakeChild);
    });

    it("passes through an empty args array (used by edge-case callers) without dropping the binary", async () => {
      const fakeChild = fakeProcess();
      spawnMock.mockReturnValue(fakeChild);

      const spawned = spawnAria2Detached([]);
      fakeChild.emit("spawn");
      await spawned;

      const [file, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(file).toBe("aria2c");
      expect(args).toEqual([]);
    });

    it("rejects an asynchronous permission failure in the launching job", async () => {
      const child = fakeProcess();
      spawnMock.mockReturnValue(child);
      const launched = spawnAria2Detached([]);
      child.emit("error", Object.assign(new Error("cannot execute"), { code: "EACCES" }));
      await expect(launched).rejects.toMatchObject({ code: "EACCES" });
    });

    it("lets the caller unref the returned child to keep the daemon detached from the parent", async () => {
      const fakeChild = fakeProcess();
      spawnMock.mockReturnValue(fakeChild);

      const child = spawnAria2Detached(["--conf-path=/tmp/x.conf"]);
      fakeChild.emit("spawn");
      (await child).unref();

      expect(fakeChild.unref).toHaveBeenCalledTimes(1);
    });
  });

  describe("isMissingAria2BinaryError", () => {
    it("returns true when the error has code === 'ENOENT' (real spawn failure)", () => {
      const err = Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT" });
      expect(isMissingAria2BinaryError(err)).toBe(true);
    });

    it("returns true for the synthetic error shape that service.ts throws when both /usr paths are absent", () => {
      const err = Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT", cause: new Error("orig") });
      expect(isMissingAria2BinaryError(err)).toBe(true);
    });

    it("returns false for permission denied, IO, and timeout errors", () => {
      expect(isMissingAria2BinaryError(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe(false);
      expect(isMissingAria2BinaryError(Object.assign(new Error("io"), { code: "EIO" }))).toBe(false);
      expect(isMissingAria2BinaryError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }))).toBe(false);
      expect(isMissingAria2BinaryError(new Error("plain error"))).toBe(false);
    });

    it("returns false for null, undefined, strings, and non-object values", () => {
      expect(isMissingAria2BinaryError(null)).toBe(false);
      expect(isMissingAria2BinaryError(undefined)).toBe(false);
      expect(isMissingAria2BinaryError("spawn aria2c ENOENT")).toBe(false);
      expect(isMissingAria2BinaryError(42)).toBe(false);
    });
  });

  describe("getMissingAria2BinaryMessage", () => {
    it("documents the actionable dependency error shown when aria2c is not installed", () => {
      expect(getMissingAria2BinaryMessage("zh")).toBe(
        "未安装 aria2c，无法进行磁力/BT 中继下载。请在服务器上安装 aria2。",
      );
    });
  });
});
