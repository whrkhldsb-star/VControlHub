import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, execFileSyncMock, execFileMock, mkdirSyncMock, rmSyncMock, writeAuditLogMock } = vi.hoisted(() => ({
	prismaMock: {
		quickService: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		auditLog: {
			findMany: vi.fn(),
		},
	},
	execFileSyncMock: vi.fn(),
	execFileMock: vi.fn(),
	mkdirSyncMock: vi.fn(),
	rmSyncMock: vi.fn(),
	writeAuditLogMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit/service", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, default: { ...actual, mkdirSync: mkdirSyncMock, rmSync: rmSyncMock }, mkdirSync: mkdirSyncMock, rmSync: rmSyncMock };
});
vi.mock("child_process", () => ({
	default: { execFileSync: execFileSyncMock, execFile: execFileMock },
	execFileSync: execFileSyncMock,
	execFile: execFileMock,
}));

import { checkPort, installService, listQuickServiceHistory, startService, stopService, syncServiceStatus, uninstallService, updateService } from "../service";
import { getDockerEnvironmentStatus } from "../docker-cli";
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
		const dockerArgs = execFileMock.mock.calls[0]![1] as string[];
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

		const dockerArgs = execFileMock.mock.calls[0]![1] as string[];
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
		).rejects.toThrow("Extra port 19090 is already in use");
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
		).rejects.toThrow(/Environment variable name|Docker socket/);
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

		const dockerArgs = execFileMock.mock.calls[0]![1] as string[];
		expect(dockerArgs).toContain("/var/run/docker.sock:/var/run/docker.sock");
	});

	it("rolls back a failed fresh install container attempt and records the error state", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce(null);
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-failed-install", slug: "demo", port: 12345 });
		prismaMock.quickService.delete.mockResolvedValueOnce({});
		execFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(Object.assign(new Error("docker run failed"), { stderr: "image pull denied" }));
			return {};
		});

		await expect(installService({ template, userId: "user-1", customPort: 12345 })).rejects.toThrow("Installation failed: image pull denied");

		expect(execFileSyncMock).toHaveBeenCalledWith("docker", ["rm", "-f", "qs-demo"], expect.objectContaining({ timeout: 15_000, encoding: "utf8" }));
		expect(prismaMock.quickService.delete).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } } });
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.install.failed",
			detail: expect.objectContaining({
				phase: "container-start",
				rollback: "deleted",
				diff: expect.objectContaining({ after: expect.objectContaining({ status: "deleted" }) }),
			}),
		}));
	});

	it("keeps failed install cleanup best-effort when removing the partial container also fails", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce(null);
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-cleanup-failed", slug: "demo", port: 12345 });
		prismaMock.quickService.delete.mockResolvedValueOnce({});
		execFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(new Error("network timeout"));
			return {};
		});
		execFileSyncMock.mockImplementation((file: string, args: string[]) => {
			if (file === "docker" && args[0] === "rm") throw new Error("cleanup denied");
			return "";
		});

		await expect(installService({ template, userId: "user-1", customPort: 12345 })).rejects.toThrow("failed to clean up leftover container");
		expect(prismaMock.quickService.delete).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } } });
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.install.failed",
			detail: expect.objectContaining({ error: expect.stringContaining("failed to clean up leftover container"), rollback: "deleted" }),
		}));
	});

	it("restores the previous service config when reinstalling over an existing row fails", async () => {
		const before = {
			id: "svc-existing",
			slug: "demo",
			status: "running",
			port: 18080,
			containerId: "oldcontainer1",
			image: "example/demo:old",
			path: "/old/",
			internalPort: 8080,
			extraPortsJson: JSON.stringify([{ host: 19090, container: 9090 }]),
			command: "serve --old",
			envJson: JSON.stringify({ OLD: "1" }),
			volumesJson: JSON.stringify([{ host: "/opt/old", container: "/data" }]),
			error: null,
		};
		prismaMock.quickService.findUnique.mockResolvedValueOnce(before);
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-existing", slug: "demo", port: 12345 });
		execFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(Object.assign(new Error("docker run failed"), { stderr: "image pull denied" }));
			return {};
		});
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await expect(installService({ template, userId: "user-1", customPort: 12345 })).rejects.toThrow("Installation failed");

		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: expect.objectContaining({
				status: "running",
				port: 18080,
				containerId: "oldcontainer1",
				image: "example/demo:old",
				path: "/old/",
				internalPort: 8080,
				extraPortsJson: before.extraPortsJson,
				command: "serve --old",
				envJson: before.envJson,
				volumesJson: before.volumesJson,
				error: null,
			}),
		});
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.install.failed",
			detail: expect.objectContaining({
				rollback: "running",
				diff: expect.objectContaining({
					before: expect.objectContaining({ image: "example/demo:old", envJson: before.envJson }),
					after: expect.objectContaining({ image: "example/demo:old", rollbackReason: "restore-previous-service-row" }),
				}),
			}),
		}));
	});

	it("keeps the DB record and marks uninstall errors when docker removal fails", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-3", slug: "demo" });
		execFileSyncMock.mockImplementationOnce(() => {
			throw new Error("docker daemon unavailable");
		});
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await expect(uninstallService("demo")).rejects.toThrow("Uninstall failed");
		expect(prismaMock.quickService.delete).not.toHaveBeenCalled();
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: expect.objectContaining({ status: "error" }),
		});
	});

	it("can remove service host data directories when uninstall requests volume deletion", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-4",
			slug: "demo",
			volumesJson: JSON.stringify([
				{ host: "/opt/demo/data", container: "/data" },
				{ host: "/srv/demo/cache/", container: "/cache" },
				{ host: "/etc/localtime", container: "/etc/localtime:ro" },
			]),
		});

		await uninstallService("demo", { deleteVolumes: true });

		expect(execFileSyncMock).toHaveBeenCalledWith("docker", ["rm", "-f", "qs-demo"], expect.objectContaining({ timeout: 15_000, encoding: "utf8" }));
		expect(rmSyncMock).toHaveBeenCalledWith("/opt/demo/data", { recursive: true, force: true });
		expect(rmSyncMock).toHaveBeenCalledWith("/srv/demo/cache", { recursive: true, force: true });
		expect(rmSyncMock).not.toHaveBeenCalledWith("/etc/localtime", expect.anything());
		expect(prismaMock.quickService.delete).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } } });
	});

	it("preserves service host data directories by default when uninstalling", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-4b",
			slug: "demo",
			volumesJson: JSON.stringify([{ host: "/opt/demo/data", container: "/data" }]),
		});

		await uninstallService("demo");

		expect(rmSyncMock).not.toHaveBeenCalled();
		expect(prismaMock.quickService.delete).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } } });
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

		await expect(startService("demo")).rejects.toThrow("Start failed");
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: { status: "error", error: expect.stringContaining("docker daemon unavailable") },
		});
	});

	it("clears stale lifecycle errors after a successful start or stop", async () => {
		// TR-011: startService/stopService now call captureQuickServiceSnapshot
		// (extra findUnique) before the existing lifecycle mutation, so the
		// fixture has to be available for every read inside the operation.
		prismaMock.quickService.findUnique.mockResolvedValue({ id: "svc-6", slug: "demo", status: "stopped", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" });
		prismaMock.quickService.update.mockResolvedValue({});

		await startService("demo");
		await stopService("demo");

		expect(prismaMock.quickService.update).toHaveBeenNthCalledWith(1, {
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: { status: "running", error: null },
		});
		expect(prismaMock.quickService.update).toHaveBeenNthCalledWith(2, {
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: { status: "stopped", error: null },
		});
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.start.started" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.start.succeeded" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.stop.started" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.stop.succeeded" }));
	});

	it("writes bounded Quick Service lifecycle history and clamps reads", async () => {
		prismaMock.auditLog.findMany.mockResolvedValueOnce([]);

		await listQuickServiceHistory(500);

		expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { action: { startsWith: "quick_service." } },
			take: 50,
		}));
	});

	it("audits uninstall failures before surfacing docker errors", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-7", slug: "demo" });
		execFileSyncMock.mockImplementationOnce(() => {
			throw Object.assign(new Error("docker daemon unavailable"), { stderr: "permission denied" });
		});
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await expect(uninstallService("demo")).rejects.toThrow("Uninstall failed: permission denied");

		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.uninstall.started" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.uninstall.failed",
			severity: "WARNING",
			detail: expect.objectContaining({ slug: "demo", error: "permission denied" }),
		}));
	});

	it("rejects concurrent operations on the same service slug", async () => {
		let releaseInstall!: () => void;
		execFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			releaseInstall = () => cb(null, { stdout: "abcdef1234567890\n", stderr: "" });
			return {};
		});
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-lock", slug: "demo", port: 12345 });
		prismaMock.quickService.update.mockResolvedValue({});
		// TR-011: install now calls captureQuickServiceSnapshot (extra
		// findUnique) before the upsert, so the pre-install lock guard
		// still has to acquire the snapshot for a real existing row.
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-lock", slug: "demo", status: "installing", port: 12345, containerId: null, image: "example/demo:latest" });

		const installing = installService({ template, userId: "user-1", customPort: 12345 });
		await expect(startService("demo")).rejects.toThrow("busy with another operation");
		// startService must not have read the row because the lock was
		// already held by the install in flight.
		expect(prismaMock.quickService.findUnique).toHaveBeenCalledTimes(1);

		releaseInstall();
		await installing;
	});

	it("updates a service by pulling its image and recreating the container", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-update",
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
			extraPortsJson: JSON.stringify([]),
			command: null,
			status: "running",
		});
		prismaMock.quickService.update.mockResolvedValue({});
		execFileSyncMock.mockImplementation((file: string, args: string[]) => {
			if (file === "docker" && args[0] === "inspect") return "healthy\n";
			if (file === "docker" && args[0] === "logs") return "old line\nservice ready\n";
			return "";
		});

		await expect(updateService("demo")).resolves.toEqual({ status: "running", health: "healthy", logTail: "old line\nservice ready" });

		expect(execFileSyncMock).toHaveBeenCalledWith("docker", ["pull", "example/demo:latest"], expect.objectContaining({ timeout: 300_000, encoding: "utf8" }));
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } }, data: { status: "installing", error: null } });
		const dockerArgs = execFileMock.mock.calls[0]![1] as string[];
		expect(dockerArgs).toEqual(expect.arrayContaining(["run", "-d", "--name", "qs-demo", "-p", "18080:8080", "example/demo:latest"]));
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { id: "svc-update" },
			data: { status: "running", containerId: "abcdef123456", error: null },
		});
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.update.started" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.update.succeeded",
			detail: expect.objectContaining({ slug: "demo", image: "example/demo:latest", health: "healthy" }),
		}));
	});

	it("marks update failures as service errors", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({
			id: "svc-update-fail",
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
			status: "stopped",
		});
		execFileSyncMock.mockImplementationOnce(() => {
			throw Object.assign(new Error("pull failed"), { stderr: "manifest unknown" });
		});
		prismaMock.quickService.update.mockResolvedValue({});

		await expect(updateService("demo")).rejects.toThrow("Update failed: manifest unknown");
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({
			where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
			data: { status: "error", error: "Update failed: manifest unknown" },
		});
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.update.failed",
			severity: "WARNING",
			detail: expect.objectContaining({ slug: "demo", error: "manifest unknown" }),
		}));
	});

	it("rejects lifecycle operations while a service is still installing", async () => {
		// TR-011: uninstallService now calls captureQuickServiceSnapshot
		// (extra findUnique) before the assertServiceNotBusy guard, so the
		// installing-state row must be readable from the fixture.
		prismaMock.quickService.findUnique.mockResolvedValue({ id: "svc-installing", slug: "demo", status: "installing", port: 12345, containerId: null, image: "example/demo:latest" });

		await expect(uninstallService("demo")).rejects.toThrow("is installing");
		expect(execFileSyncMock).not.toHaveBeenCalledWith("docker", expect.arrayContaining(["rm", "-f", "qs-demo"]), expect.anything());
		expect(prismaMock.quickService.delete).not.toHaveBeenCalled();
	});

	it("reports actionable Docker environment guidance before install attempts", () => {
		execFileSyncMock.mockImplementationOnce(() => {
			throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
		});

		expect(getDockerEnvironmentStatus()).toEqual(expect.objectContaining({
			available: false,
			message: "Docker is not installed",
			installHint: expect.stringContaining("get.docker.com"),
		}));
	});

	it("returns invalid for out-of-range port checks without shelling out", () => {
		expect(checkPort(70000)).toEqual({ available: false, usedBy: null });
		expect(execFileSyncMock).not.toHaveBeenCalled();
	});

	it("checks listening ports with argv-based ss execution instead of shell grep", () => {
		execFileSyncMock.mockImplementation((file: string, args: string[]) => {
			if (file === "ss" && args[0] === "-tlnpH") return "LISTEN 0 128 0.0.0.0:12345 0.0.0.0:* users:((\"node\",pid=4242,fd=18))\n";
			if (file === "tr") return "node server.js ";
			return "";
		});

		expect(checkPort(12345)).toEqual({ available: false, usedBy: "node server.js" });
		expect(execFileSyncMock).toHaveBeenCalledWith("ss", ["-tlnpH"], expect.any(Object));
		expect(execFileSyncMock).not.toHaveBeenCalledWith(expect.stringContaining("grep"), expect.anything(), expect.anything());
	});

	it("treats missing quick-service containers as stopped during status sync instead of surfacing docker inspect noise", async () => {
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-sync", slug: "demo" });
		execFileSyncMock.mockImplementationOnce(() => {
			throw Object.assign(new Error("Command failed: docker inspect --format={{.State.Status}} qs-demo\nError: No such object: qs-demo\n"), {
				stderr: "Error: No such object: qs-demo\n",
				stdout: "",
			});
		});
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await expect(syncServiceStatus("demo")).resolves.toBe("stopped");
		expect(execFileSyncMock).toHaveBeenCalledWith(
			"docker",
			["inspect", "--format={{.State.Status}}", "qs-demo"],
			expect.objectContaining({ timeout: 10_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
		);
		expect(prismaMock.quickService.update).toHaveBeenCalledWith({ where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } }, data: { status: "stopped" } });
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "quick_service.sync.started" }));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.sync.succeeded",
			detail: expect.objectContaining({ slug: "demo", status: "stopped", missingContainer: true }),
		}));
	});

	// -- TR-011: lifecycle audit diff records -------------------------------

	it("records a before/after diff on successful install so operators can see the new state", async () => {
		// TR-011: pre-existing failed install row → re-installing it should
		// snapshot the previous "error" row and the audit "started" entry
		// must carry that as the diff.before.
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-diff", slug: "demo", status: "error", port: 12345, containerId: null, image: "example/demo:latest", error: "image pull denied" });
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-diff", slug: "demo", port: 12345 });
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await installService({ template, userId: "user-1", customPort: 12345 });

		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.install.started",
			detail: expect.objectContaining({
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "error", port: 12345, error: "image pull denied" }),
				}),
			}),
		}));
	});

	it("records a real before/after diff on successful install and includes the new container id", async () => {
		// New install path (no pre-existing row) → diff.before is null and
		// the "succeeded" audit carries the running state.
		prismaMock.quickService.findUnique.mockResolvedValueOnce(null);
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-fresh", slug: "demo", port: 12345 });
		prismaMock.quickService.update.mockResolvedValueOnce({});

		await installService({ template, userId: "user-1", customPort: 12345 });
		await vi.waitFor(() => {
			expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
				action: "quick_service.install.succeeded",
				detail: expect.objectContaining({
					diff: expect.objectContaining({
						after: expect.objectContaining({ status: "running", port: 12345, containerId: "abcdef123456" }),
					}),
				}),
			}));
		});
	});

	it("records the before/after diff on uninstall so the deleted intent is auditable", async () => {
		prismaMock.quickService.findUnique
			.mockResolvedValueOnce({ id: "svc-uninst", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" })
			.mockResolvedValueOnce({ id: "svc-uninst", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" });
		prismaMock.quickService.delete.mockResolvedValueOnce({});

		await uninstallService("demo");

		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.uninstall.started",
			detail: expect.objectContaining({
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "running", port: 18080, containerId: "abcdef123456" }),
				}),
			}),
		}));
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.uninstall.succeeded",
			detail: expect.objectContaining({
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "running", port: 18080 }),
					after: expect.objectContaining({ status: "deleted" }),
				}),
			}),
		}));
	});

	it("rolls back a partial uninstall when the DB delete fails and audits the rollback", async () => {
		// The container is already removed but the DB row deletion fails
		// (e.g. transient connection drop) → the row must be kept with
		// status=stopped and the diff must capture the rollback intent.
		prismaMock.quickService.findUnique
			.mockResolvedValueOnce({ id: "svc-uninst-partial", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" })
			.mockResolvedValueOnce({ id: "svc-uninst-partial", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" });
		prismaMock.quickService.delete.mockRejectedValueOnce(Object.assign(new Error("db connection lost"), { code: "P1001" }));
		prismaMock.quickService.update.mockResolvedValue({});

		await expect(uninstallService("demo")).rejects.toThrow("Uninstall rollback");

		expect(prismaMock.quickService.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { instanceKey_slug: { instanceKey: "hub-host", slug: "demo" } },
				data: expect.objectContaining({ status: "stopped" }),
			}),
		);
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.uninstall.failed",
			detail: expect.objectContaining({
				phase: "db-delete",
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "running" }),
					after: expect.objectContaining({ status: "stopped" }),
				}),
			}),
		}));
	});

	it("records a failed-install audit when the prisma upsert itself throws", async () => {
		// TR-011: install's pre-container mutation (prisma.upsert) used to
		// leave a dangling "started" audit with no "failed" sibling. The
		// refactor wraps the upsert in try/catch and records the diff so
		// operators can see the attempted state transition.
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-upsert-fail", slug: "demo", status: "error", port: 12345, containerId: null, image: "example/demo:latest", error: "stale row" });
		prismaMock.quickService.upsert.mockRejectedValueOnce(new Error("connection refused"));

		await expect(installService({ template, userId: "user-1", customPort: 12345 })).rejects.toThrow("Installation failed: connection refused");

		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.install.failed",
			severity: "WARNING",
			detail: expect.objectContaining({
				phase: "upsert",
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "error", error: "stale row" }),
					after: expect.objectContaining({ status: "error", port: 12345, error: "connection refused" }),
				}),
			}),
		}));
	});

	it("records the before/after diff on stop and update", async () => {
		// stop: stopped-from-running should round-trip both sides in the diff.
		prismaMock.quickService.findUnique
			.mockResolvedValueOnce({ id: "svc-stop", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" })
			.mockResolvedValueOnce({ id: "svc-stop", slug: "demo", status: "running", port: 18080, containerId: "abcdef123456", image: "example/demo:latest" });
		prismaMock.quickService.update.mockResolvedValue({});
		await stopService("demo");
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.stop.succeeded",
			detail: expect.objectContaining({
				diff: expect.objectContaining({
					before: expect.objectContaining({ status: "running", port: 18080 }),
					after: expect.objectContaining({ status: "stopped" }),
				}),
			}),
		}));

		// update: a successful image pull should diff the new image in after.
		vi.clearAllMocks();
		execFileSyncMock.mockReturnValue("");
		execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(null, { stdout: "newcontainer12\n", stderr: "" });
			return {};
		});
		writeAuditLogMock.mockResolvedValue(undefined);
		prismaMock.quickService.findUnique.mockResolvedValueOnce({ id: "svc-upd", slug: "demo", name: "Demo", category: "other", icon: "pkg", description: "Demo", image: "example/demo:new", port: 18080, path: "/demo/", envJson: "{}", volumesJson: "[]", internalPort: null, extraPortsJson: "[]", command: null, status: "running" });
		prismaMock.quickService.update.mockResolvedValue({});
		execFileSyncMock.mockImplementation((file: string, args: string[]) => {
			if (file === "docker" && args[0] === "inspect") return "healthy\n";
			if (file === "docker" && args[0] === "logs") return "ready\n";
			return "";
		});

		await updateService("demo");
		expect(writeAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
			action: "quick_service.update.succeeded",
			detail: expect.objectContaining({
				diff: expect.objectContaining({
					after: expect.objectContaining({ status: "running", image: "example/demo:new", health: "healthy" }),
				}),
			}),
		}));
	});
});
