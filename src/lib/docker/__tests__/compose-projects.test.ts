import { beforeEach, describe, expect, it, vi } from "vitest";

const { dockerRequestMock, execRemoteMock, buildSshMock, prismaMock, runFileImpl } = vi.hoisted(() => ({
  dockerRequestMock: vi.fn(),
  execRemoteMock: vi.fn(),
  buildSshMock: vi.fn(),
  runFileImpl: vi.fn(),
  prismaMock: {
    server: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: vi.fn(async () => async () => undefined),
}));

vi.mock("@/lib/docker/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../engine-client")>("../engine-client");
  return {
    ...actual,
    dockerRequest: dockerRequestMock,
  };
});

vi.mock("@/lib/ssh/client", () => ({
  execRemoteCommand: execRemoteMock,
  buildSshParamsFromServer: buildSshMock,
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  // Callback-style execFile so real util.promisify works in compose-projects.
  const execFile = (
    file: string,
    args?: string[] | object,
    options?: object | ((err: Error | null, stdout: string, stderr: string) => void),
    callback?: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    let argv: string[] = [];
    let cb: ((err: Error | null, stdout: string, stderr: string) => void) | undefined = callback;
    if (Array.isArray(args)) {
      argv = args;
      if (typeof options === "function") cb = options as (err: Error | null, stdout: string, stderr: string) => void;
    }
    const promise = Promise.resolve().then(() => runFileImpl(file, argv));
    if (typeof cb === "function") {
      promise.then(
        (result: { stdout?: string; stderr?: string }) => {
          cb?.(null, String(result?.stdout ?? ""), String(result?.stderr ?? ""));
        },
        (err: Error) => {
          cb?.(err, "", "");
        },
      );
      return undefined;
    }
    return promise;
  };
  return {
    ...actual,
    execFile,
    default: {
      ...actual,
      execFile,
    },
  };
});

import {
  assertValidComposeProjectName,
  groupComposeProjects,
  isComposeCliFallbackError,
  listComposeProjects,
  runComposeProjectAction,
} from "../compose-projects";

function container(partial: {
  id: string;
  project: string;
  service?: string;
  state?: string;
  workingDir?: string;
  configFiles?: string;
}) {
  return {
    Id: partial.id,
    Names: [`/${partial.project}-${partial.service ?? "web"}-1`],
    State: partial.state ?? "running",
    Status: partial.state === "exited" ? "Exited" : "Up 1 minute",
    Image: "nginx:latest",
    Labels: {
      "com.docker.compose.project": partial.project,
      "com.docker.compose.service": partial.service ?? "web",
      ...(partial.workingDir
        ? { "com.docker.compose.project.working_dir": partial.workingDir }
        : {}),
      ...(partial.configFiles
        ? { "com.docker.compose.project.config_files": partial.configFiles }
        : {}),
    },
  };
}

const hubScope = {
  scope: "hub-host" as const,
  socketPath: "/var/run/docker.sock",
  warning: "local",
};

describe("compose project helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildSshMock.mockResolvedValue({ host: "1.2.3.4", port: 22, username: "root" });
  });

  it("validates project names", () => {
    expect(assertValidComposeProjectName("site")).toBe("site");
    expect(() => assertValidComposeProjectName("../evil")).toThrow(/Invalid compose project/);
    expect(() => assertValidComposeProjectName("has space")).toThrow(/Invalid compose project/);
  });

  it("groups containers by compose project label", () => {
    const projects = groupComposeProjects([
      container({ id: "a", project: "site", service: "web" }),
      container({ id: "b", project: "site", service: "db", state: "exited" }),
      container({ id: "c", project: "blog", service: "app" }),
      {
        Id: "loose",
        Names: ["/orphan"],
        State: "running",
        Status: "Up",
        Image: "busybox",
        Labels: {},
      },
    ]);
    expect(projects).toHaveLength(2);
    expect(projects[0]?.project).toBe("blog");
    expect(projects[1]?.project).toBe("site");
    expect(projects[1]?.containerCount).toBe(2);
    expect(projects[1]?.runningCount).toBe(1);
    expect(projects[1]?.services).toEqual(["db", "web"]);
  });

  it("lists compose projects via engine API", async () => {
    dockerRequestMock.mockResolvedValueOnce({
      result: {
        ok: true,
        status: 200,
        data: [container({ id: "a", project: "site" })],
      },
      scope: hubScope,
    });

    const listed = await listComposeProjects();
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]?.project).toBe("site");
    expect(listed.dockerAvailable).toBe(true);
  });

  it("runs compose up via local docker compose CLI", async () => {
    dockerRequestMock
      .mockResolvedValueOnce({
        result: {
          ok: true,
          status: 200,
          data: [
            container({
              id: "a",
              project: "site",
              workingDir: "/opt/site",
              configFiles: "/opt/site/compose.yml",
            }),
          ],
        },
        scope: hubScope,
      })
      .mockResolvedValueOnce({
        result: {
          ok: true,
          status: 200,
          data: [container({ id: "a", project: "site", state: "running" })],
        },
        scope: hubScope,
      });

    runFileImpl.mockResolvedValue({ stdout: "Creating site-web-1", stderr: "" });

    const result = await runComposeProjectAction({ project: "site", action: "up" });
    expect(result.mode).toBe("compose-cli");
    expect(result.action).toBe("up");
    expect(result.project).toBe("site");
    expect(runFileImpl).toHaveBeenCalled();
    const call = runFileImpl.mock.calls[0];
    expect(call?.[0]).toBe("docker");
    expect(call?.[1]).toEqual(
      expect.arrayContaining(["compose", "-p", "site", "up", "-d", "--remove-orphans"]),
    );
  });

  it("falls back to Engine API start when compose CLI is missing", async () => {
    dockerRequestMock
      // initial label list in runComposeProjectAction
      .mockResolvedValueOnce({
        result: {
          ok: true,
          status: 200,
          data: [container({ id: "abc123", project: "site", state: "exited" })],
        },
        scope: hubScope,
      })
      // list inside engineActionOnProjectContainers
      .mockResolvedValueOnce({
        result: {
          ok: true,
          status: 200,
          data: [container({ id: "abc123", project: "site", state: "exited" })],
        },
        scope: hubScope,
      })
      // start container
      .mockResolvedValueOnce({
        result: { ok: true, status: 204, data: null },
        scope: hubScope,
      })
      // after list inside engineAction
      .mockResolvedValueOnce({
        result: {
          ok: true,
          status: 200,
          data: [container({ id: "abc123", project: "site", state: "running" })],
        },
        scope: hubScope,
      });

    runFileImpl.mockRejectedValue(
      Object.assign(new Error("not found"), {
        code: 1,
        stdout: "",
        stderr: "docker: unknown command: docker compose\nunknown shorthand flag: 'p' in -p",
      }),
    );

    const result = await runComposeProjectAction({ project: "site", action: "start" });
    expect(result.mode).toBe("engine-fallback");
    expect(result.containers?.[0]?.state).toBe("running");
  });

  it("does not fall back when compose fails with a business error containing 'not found'", async () => {
    dockerRequestMock.mockResolvedValueOnce({
      result: {
        ok: true,
        status: 200,
        data: [container({ id: "abc123", project: "site", state: "exited" })],
      },
      scope: hubScope,
    });

    runFileImpl.mockRejectedValue(
      Object.assign(new Error("compose failed"), {
        code: 1,
        stdout: "",
        stderr: "Error response from daemon: network site_default not found",
      }),
    );

    await expect(runComposeProjectAction({ project: "site", action: "up" })).rejects.toThrow(
      /network site_default not found/i,
    );
    // Must not attempt Engine start/stop after a real compose failure
    expect(dockerRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe("isComposeCliFallbackError", () => {
  it("matches missing compose plugin / unknown command", () => {
    expect(
      isComposeCliFallbackError("docker: 'compose' is not a docker command"),
    ).toBe(true);
    expect(
      isComposeCliFallbackError("docker: unknown command: docker compose\nunknown shorthand flag: 'p' in -p"),
    ).toBe(true);
    expect(isComposeCliFallbackError("docker cli not found")).toBe(true);
    expect(isComposeCliFallbackError("no configuration file provided")).toBe(true);
  });

  it("rejects ordinary compose business errors that mention not found / no such file", () => {
    expect(isComposeCliFallbackError("network site_default not found")).toBe(false);
    expect(isComposeCliFallbackError("pull access denied for foo, repository does not exist")).toBe(
      false,
    );
    expect(isComposeCliFallbackError("no such file or directory: ./missing.yml")).toBe(false);
    expect(isComposeCliFallbackError("error while interpolating services.web.image: required variable FOO is missing")).toBe(
      false,
    );
  });
});
