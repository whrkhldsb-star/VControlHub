import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
	execFileSyncMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("child_process")>();
	const mockedModule = {
		...actual,
		execFileSync: execFileSyncMock,
	};

	return {
		__esModule: true,
		...mockedModule,
		default: mockedModule,
	};
});

import { dockerErrorMessage, dockerExecSync, getContainerHealth, getContainerLogTail, getDockerEnvironmentStatus } from "../docker-cli";

describe("quick-service docker-cli adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("dockerExecSync", () => {
		it("forwards args to docker with the documented sync stdio/encoding/timeout", () => {
			execFileSyncMock.mockReturnValueOnce("docker version output");

			const result = dockerExecSync(["version"]);

			expect(result).toBe("docker version output");
			expect(execFileSyncMock).toHaveBeenCalledWith(
				"docker",
				["version"],
				expect.objectContaining({ timeout: 30_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
			);
		});

		it("respects a caller-provided timeout when given", () => {
			execFileSyncMock.mockReturnValueOnce("");

			dockerExecSync(["pull", "alpine"], 5_000);

			expect(execFileSyncMock).toHaveBeenCalledWith(
				"docker",
				["pull", "alpine"],
				expect.objectContaining({ timeout: 5_000 }),
			);
		});

		it("propagates execFileSync errors untouched so callers can recover", () => {
			const boom = Object.assign(new Error("docker not running"), { code: "EACCES" });
			execFileSyncMock.mockImplementationOnce(() => {
				throw boom;
			});

			expect(() => dockerExecSync(["info"])).toThrow(boom);
		});
	});

	describe("dockerErrorMessage", () => {
		it("prefers stderr, falls back to stdout, then message, then String(error)", () => {
			expect(
				dockerErrorMessage(
					Object.assign(new Error("ignored"), { stderr: "  bad arg  \n", stdout: "  hello  \n" }),
				),
			).toBe("bad arg");
			expect(
				dockerErrorMessage(
					Object.assign(new Error("ignored"), { stderr: "", stdout: "  hello  \n" }),
				),
			).toBe("hello");
			expect(dockerErrorMessage(new Error("  no stderr  "))).toBe("no stderr");
			expect(dockerErrorMessage("plain string error")).toBe("plain string error");
		});

		it("returns String(error) for non-object inputs", () => {
			expect(dockerErrorMessage(42)).toBe("42");
		});
	});

	describe("getContainerHealth", () => {
		it("returns the trimmed docker inspect health/status string", () => {
			execFileSyncMock.mockReturnValueOnce("  running  \n");

			expect(getContainerHealth("qs-alist")).toBe("running");
			expect(execFileSyncMock).toHaveBeenCalledWith(
				"docker",
				["inspect", "--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", "qs-alist"],
				expect.objectContaining({ timeout: 10_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
			);
		});

		it("returns null when docker inspect throws (container missing/daemon down)", () => {
			execFileSyncMock.mockImplementationOnce(() => {
				throw new Error("No such object: qs-missing");
			});

			expect(getContainerHealth("qs-missing")).toBeNull();
		});

		it("returns null when docker inspect returns an empty string", () => {
			execFileSyncMock.mockReturnValueOnce("   \n");

			expect(getContainerHealth("qs-empty")).toBeNull();
		});
	});

	describe("getContainerLogTail", () => {
		it("returns the trimmed last 20 log lines when present", () => {
			execFileSyncMock.mockReturnValueOnce("line1\nline2\nline3\n");

			expect(getContainerLogTail("qs-alist")).toBe("line1\nline2\nline3");
			expect(execFileSyncMock).toHaveBeenCalledWith(
				"docker",
				["logs", "--tail", "20", "qs-alist"],
				expect.objectContaining({ timeout: 10_000 }),
			);
		});

		it("truncates the log tail to the last 2000 characters", () => {
			const long = "x".repeat(3000) + "\nlast";
			execFileSyncMock.mockReturnValueOnce(long);

			const result = getContainerLogTail("qs-long");
			expect(result?.length).toBe(2000);
			expect(result?.endsWith("last")).toBe(true);
		});

		it("returns null when docker logs throws", () => {
			execFileSyncMock.mockImplementationOnce(() => {
				throw new Error("daemon down");
			});

			expect(getContainerLogTail("qs-broken")).toBeNull();
		});

		it("returns null when docker logs returns only whitespace", () => {
			execFileSyncMock.mockReturnValueOnce("\n\n  \n");

			expect(getContainerLogTail("qs-empty")).toBeNull();
		});
	});

	describe("getDockerEnvironmentStatus", () => {
		it("reports available + running + version when docker is healthy", () => {
			execFileSyncMock
				.mockReturnValueOnce("Docker version 24.0.7, build afdd53b")
				.mockReturnValueOnce("Server: Docker Engine\n");

			const status = getDockerEnvironmentStatus();

			expect(status).toEqual({
				available: true,
				running: true,
				version: "Docker version 24.0.7, build afdd53b",
				message: null,
				installHint: null,
			});
			expect(execFileSyncMock).toHaveBeenNthCalledWith(1, "docker", ["--version"], expect.any(Object));
			expect(execFileSyncMock).toHaveBeenNthCalledWith(2, "docker", ["info"], expect.any(Object));
		});

		it("classifies ENOENT / not-found errors as Docker not installed", () => {
			execFileSyncMock.mockImplementationOnce(() => {
				throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
			});

			expect(getDockerEnvironmentStatus()).toEqual(
				expect.objectContaining({
					available: false,
					running: false,
					version: null,
					message: "Docker is not installed",
					installHint: expect.stringContaining("get.docker.com"),
				}),
			);
		});

		it("classifies non-ENOENT errors as Docker not running / daemon unreachable", () => {
			execFileSyncMock.mockImplementationOnce(() => {
				throw Object.assign(new Error("Cannot connect to the Docker daemon"), { code: "EACCES" });
			});

			expect(getDockerEnvironmentStatus()).toEqual(
				expect.objectContaining({
					available: false,
					running: false,
					version: null,
					message: expect.stringContaining("Docker is not running"),
					installHint: expect.stringContaining("get.docker.com"),
				}),
			);
		});

		it("also treats 'not found' / 'no such file' substrings as Docker not installed", () => {
			execFileSyncMock.mockImplementationOnce(() => {
				throw new Error("docker: not found");
			});

			expect(getDockerEnvironmentStatus()).toEqual(
				expect.objectContaining({ message: "Docker is not installed" }),
			);
		});
	});
});
