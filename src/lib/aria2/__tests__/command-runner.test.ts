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
  MISSING_ARIA2_BINARY_MESSAGE,
  isMissingAria2BinaryError,
  spawnAria2Detached,
} from "../command-runner";

type FakeChildProcess = { unref: () => void };

describe("aria2 command-runner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spawnAria2Detached", () => {
    it("forwards the args to spawn('aria2c', ...) with detached + stdio:'ignore' and returns the child", () => {
      const fakeChild: FakeChildProcess = { unref: vi.fn() };
      spawnMock.mockReturnValue(fakeChild);

      const child = spawnAria2Detached(["--conf-path=/tmp/x.conf"]);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [file, args, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(file).toBe("aria2c");
      expect(args).toEqual(["--conf-path=/tmp/x.conf"]);
      expect(opts).toEqual({ detached: true, stdio: "ignore" });
      expect(child).toBe(fakeChild);
    });

    it("passes through an empty args array (used by edge-case callers) without dropping the binary", () => {
      const fakeChild: FakeChildProcess = { unref: vi.fn() };
      spawnMock.mockReturnValue(fakeChild);

      spawnAria2Detached([]);

      const [file, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(file).toBe("aria2c");
      expect(args).toEqual([]);
    });

    it("lets the caller unref the returned child to keep the daemon detached from the parent", () => {
      const unrefMock = vi.fn();
      spawnMock.mockReturnValue({ unref: unrefMock });

      const child = spawnAria2Detached(["--conf-path=/tmp/x.conf"]);
      child.unref();

      expect(unrefMock).toHaveBeenCalledTimes(1);
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

  describe("MISSING_ARIA2_BINARY_MESSAGE", () => {
    it("documents the actionable dependency error shown when aria2c is not installed", () => {
      expect(MISSING_ARIA2_BINARY_MESSAGE).toBe(
        "aria2c is not installed; cannot perform magnet/BT relay download. Please install aria2 on the server",
      );
    });
  });
});
