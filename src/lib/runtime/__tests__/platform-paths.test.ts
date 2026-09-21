import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IS_WINDOWS,
  defaultDataRoot,
  dockerEngineEndpoint,
  dockerEngineSocketPath,
  relayTempDir,
} from "@/lib/runtime/platform-paths";

describe("platform-paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("relayTempDir", () => {
    it("keeps the historical /tmp layout on POSIX", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      expect(relayTempDir("job_1")).toBe("/tmp/app-relay-job_1");
    });

    it("uses the OS temp dir (no leading slash) on Windows", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      const dir = relayTempDir("job_1");
      expect(dir).toContain("app-relay-job_1");
      expect(dir.startsWith("/")).toBe(false);
      expect(dir.includes("/tmp/")).toBe(false);
    });
  });

  describe("defaultDataRoot", () => {
    it("keeps /var/lib/vcontrolhub on POSIX", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      expect(defaultDataRoot()).toBe("/var/lib/vcontrolhub");
    });

    it("uses Program Data (not /var) on Windows", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      process.env.PROGRAMDATA = "C:\\ProgramData";
      expect(defaultDataRoot()).toBe("C:\\ProgramData\\VControlHub");
    });
  });

  describe("dockerEngineEndpoint", () => {
    afterEach(() => {
      delete process.env.DOCKER_HOST;
    });

    it("defaults to the unix socket on POSIX", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      expect(dockerEngineEndpoint()).toEqual({
        kind: "socket",
        socketPath: "/var/run/docker.sock",
      });
    });

    it("defaults to the Docker Desktop named pipe on Windows", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      expect(dockerEngineEndpoint()).toEqual({
        kind: "socket",
        socketPath: "\\\\.\\pipe\\docker_engine",
      });
    });

    it("honours DOCKER_HOST unix://, npipe:// and tcp:// forms", () => {
      process.env.DOCKER_HOST = "unix:///run/user/1000/docker.sock";
      expect(dockerEngineEndpoint()).toEqual({ kind: "socket", socketPath: "/run/user/1000/docker.sock" });

      process.env.DOCKER_HOST = "npipe:////./pipe/docker_engine";
      expect(dockerEngineEndpoint()).toEqual({ kind: "socket", socketPath: "\\\\.\\pipe\\docker_engine" });

      process.env.DOCKER_HOST = "tcp://127.0.0.1:2375";
      expect(dockerEngineEndpoint()).toEqual({ kind: "tcp", host: "127.0.0.1", port: 2375 });

      process.env.DOCKER_HOST = "tcp://docker.internal";
      expect(dockerEngineEndpoint()).toEqual({ kind: "tcp", host: "docker.internal", port: 2375 });
    });

    it("falls back to the platform default on a malformed tcp:// host", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      process.env.DOCKER_HOST = "tcp://[bad";
      expect(dockerEngineEndpoint()).toEqual({ kind: "socket", socketPath: "/var/run/docker.sock" });
    });
  });

  describe("dockerEngineSocketPath", () => {
    it("renders tcp endpoints as a URL", () => {
      process.env.DOCKER_HOST = "tcp://127.0.0.1:2375";
      expect(dockerEngineSocketPath()).toBe("tcp://127.0.0.1:2375");
      delete process.env.DOCKER_HOST;
    });
  });

  it("IS_WINDOWS reflects the real platform when nothing is mocked", () => {
    expect(IS_WINDOWS).toBe(process.platform === "win32");
  });
});
