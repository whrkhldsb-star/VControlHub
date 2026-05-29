import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, execFileSyncMock, execFileMock, execSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
	prismaMock: {
		quickService: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
	},
	execFileSyncMock: vi.fn(),
	execFileMock: vi.fn(),
	execSyncMock: vi.fn(),
	mkdirSyncMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, default: { ...actual, mkdirSync: mkdirSyncMock }, mkdirSync: mkdirSyncMock };
});
vi.mock("child_process", () => ({
	default: { execFileSync: execFileSyncMock, execSync: execSyncMock, execFile: execFileMock },
	execFileSync: execFileSyncMock,
	execFile: execFileMock,
	execSync: execSyncMock,
}));

import { checkPort, getDockerEnvironmentStatus, installService, startService, uninstallService } from "../service";
import type { ServiceTemplate } from "../types";

const template: ServiceTemplate = {
	slug: "demo",
	name: "Demo",
	category: "other",
	icon: "pkg",
	description: "Demo service",
	image: "example/demo:latest",
	defaultPort: 12345,
	path: "/demo/",
	envJson: { DEMO_HOST: "127.0.0.1", EMPTY: "" },
	volumesJson: [{ host: "/opt/demo/data", container: "/data" }],
};

describe("quick service docker lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		execFileSyncMock.mockReturnValue("");
		execSyncMock.mockReturnValue("");
		execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(null, { stdout: "abcdef1234567890\n", stderr: "" });
			return {};
		});
	});

	it("runs docker with argv arguments and stores running container id after install", async () => {
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-1", slug: "demo", port: 12345 });
		prismaMock.quickService.update.mockResolvedValueOnce({});

		const svc = await installService({ template, userId: "user-1", customPort: 12345 });

		expect(svc.port).toBe(12345);
		expect(mkdirSyncMock).toHaveBeenCalledWith("/opt/demo/data", { recursive: true });
		expect(execFileMock).toHaveBeenCalledWith(
			"docker",
			expect.arrayContaining(["run", "-d", "--name", "qs-demo", "-p", "12345:12345", "-v", "/opt/demo/data:/data", "-e", "DEMO_HOST=host.docker.internal", "example/demo:latest"]),
			expect.objectContaining({ timeout: 300_000 }),
			expect.any(Function),
		);
		const dockerArgs = execFileMock.mock.calls[0][1] as string[];
		expect(dockerArgs).not.toContain("EMPTY=");
		expect(dockerArgs.join(" ")).not.toContain("'qs-demo'");
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { id: "svc-1" },
			data: { status: "running", containerId: "abcdef123456", error: null },
		});
	});

	it("restores stored internalPort, extraPorts and command when recreating a removed container", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-2",
			slug: "demo",
			name: "Demo",
			category: "other",
			icon: "pkg",
			description: "Demo service",
			image: "example/demo:latest",
			port: 18080,
			path: "/demo/",
			envJson: JSON.stringify({ DEMO_HOST: "localhost" }),
			volumesJson: JSON.stringify([{ host: "/opt/demo/data", container: "/data" }]),
			internalPort: 8080,
			extraPortsJson: JSON.stringify([{ host: 19090, container: 9090 }]),
			command: "serve --safe",
		});
		execFileSyncMock.mockImplementationOnce(() => {
			throw new Error("missing container");
		});
		prismaMock.quickService.update.mockResolvedValue({});

		await startService("demo");

		const dockerArgs = execFileMock.mock.calls[0][1] as string[];
		expect(dockerArgs).toEqual(expect.arrayContaining(["-p", "18080:8080", "-p", "19090:9090"]));
		expect(dockerArgs.slice(-3)).toEqual(["example/demo:latest", "serve", "--safe"]);
	});

	it("preflights extra host ports before installing a template", async () => {
		execFileSyncMock.mockImplementation((file: string, args: string[]) => {
			if (file === "node" && args.includes("19090")) throw new Error("port busy");
			return "";
		});

		await expect(
			installService({
				template: { ...template, extraPorts: [{ host: 19090, container: 9090 }] },
				customPort: 12345,
			}),
		).rejects.toThrow("额外端口 19090 已被占用");
		expect(prismaMock.quickService.upsert).not.toHaveBeenCalled();
	});

	it("rejects unsafe remote templates before docker execution", async () => {
		await expect(
			installService({
				template: {
					...template,
					envJson: { "BAD;KEY": "value" },
					volumesJson: [{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" }],
				},
				customPort: 12345,
			}),
		).rejects.toThrow(/环境变量名|Docker socket/);
		expect(execFileMock).not.toHaveBeenCalled();
		expect(prismaMock.quickService.upsert).not.toHaveBeenCalled();
	});

	it("allows Docker socket only for trusted built-in templates", async () => {
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-4", slug: "portainer", port: 9443 });
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await installService({
			template: {
				...template,
				slug: "portainer",
				image: "portainer/portainer-ce:latest",
				volumesJson: [{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" }],
				allowDockerSocket: true,
			},
			customPort: 9443,
		});

		const dockerArgs = execFileMock.mock.calls[0][1] as string[];
		expect(dockerArgs).toContain("/var/run/docker.sock:/var/run/docker.sock");
	});

	it("keeps the DB record and marks uninstall errors when docker removal fails", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-3", slug: "demo" });
		execFileSyncMock.mockImplementationOnce(() => {
			throw new Error("docker daemon unavailable");
		});
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await expect(uninstallService("demo")).rejects.toThrow("卸载失败");
		expect(prismaMock.quickService.delete).not.toHaveBeenCalled();
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { slug: "demo" },
			data: expect.objectContaining({ status: "error" }),
		});
	});

	it("marks the service error when recreating a missing container fails", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-5",
			slug: "demo",
			name: "Demo",
			category: "other",
			icon: "pkg",
			description: "Demo service",
			image: "example/demo:latest",
			port: 18080,
			path: "/demo/",
			envJson: JSON.stringify({}),
			volumesJson: JSON.stringify([]),
			internalPort: null,
			extraPortsJson: JSON.stringify([]),
			command: null,
		});
		execFileSyncMock.mockImplementationOnce(() => {
			throw new Error("missing container");
		});
		execFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(new Error("docker daemon unavailable"));
			return {};
		});
		prismaMock.quickService.update.mockResolvedValue({});

		await expect(startService("demo")).rejects.toThrow("启动失败");
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { slug: "demo" },
			data: { status: "error", error: expect.stringContaining("docker daemon unavailable") },
		});
	});

	it("reports actionable Docker environment guidance before install attempts", () => {
		execFileSyncMock.mockImplementationOnce(() => {
			throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
		});

		expect(getDockerEnvironmentStatus()).toEqual(expect.objectContaining({
			available: false,
			message: "Docker 未安装",
			installHint: expect.stringContaining("get.docker.com"),
		}));
	});

	it("returns invalid for out-of-range port checks without shelling out", () => {
		expect(checkPort(70000)).toEqual({ available: false, usedBy: null });
		expect(execSyncMock).not.toHaveBeenCalled();
	});
});
