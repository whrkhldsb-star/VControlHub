import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quick-service recreate/start against an in-memory Docker daemon. The
 * assertions are about which containers exist and run afterwards: the previous
 * container must survive every injected failure (daemon error on inspect,
 * rename refused, new container exiting or unhealthy, bookkeeping failure
 * after a successful start).
 */
type Container = { id: string; image: string; state: "running" | "exited"; health: string; restarts: number };

const { docker, prismaMock, faults } = vi.hoisted(() => ({
	docker: new Map<string, Container>(),
	faults: {
		inspectError: "" as string,
		renameError: "" as string,
		startError: "" as string,
		/** State an existing container is left in by `docker start`. */
		startLeaves: "running" as Container["state"],
		newContainer: { state: "running", health: "", restarts: 0 } as Pick<Container, "state" | "health" | "restarts">,
	},
	prismaMock: {
		quickService: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
		auditLog: { findMany: vi.fn() },
	},
}));

function dockerError(stderr: string) {
	return Object.assign(new Error(`Command failed: docker\n${stderr}`), { stderr });
}

function dockerSync(args: string[]): string {
	const [verb, ...rest] = args;
	const name = rest.at(-1)!;
	switch (verb) {
		case "inspect": {
			if (faults.inspectError) throw dockerError(faults.inspectError);
			const container = docker.get(name);
			if (!container) throw dockerError(`Error: No such object: ${name}`);
			if (String(rest[0]).includes("{{.State.Status}}|")) return `${container.state}|${container.health}|${container.restarts}\n`;
			return `${container.id}\n`;
		}
		case "rm":
			docker.delete(name);
			return "";
		case "rename": {
			if (faults.renameError) throw dockerError(faults.renameError);
			const [from, to] = rest;
			const container = docker.get(from!);
			if (!container) throw dockerError(`Error response from daemon: No such container: ${from}`);
			docker.delete(from!);
			docker.set(to!, container);
			return "";
		}
		case "stop": {
			const container = docker.get(name);
			if (container) container.state = "exited";
			return "";
		}
		case "start": {
			if (faults.startError) throw dockerError(faults.startError);
			const container = docker.get(name);
			if (!container) throw dockerError(`Error response from daemon: No such container: ${name}`);
			container.state = faults.startLeaves;
			return "";
		}
		case "logs":
			return "log line\n";
		default:
			return "";
	}
}

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit/service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/notification/service", () => ({ createNotification: vi.fn() }));
vi.mock("child_process", () => {
	const execFileSync = vi.fn((_file: string, args: string[]) => dockerSync(args));
	const spawnSync = vi.fn((_file: string, args: string[]) => ({ stdout: dockerSync(args), stderr: "", status: 0 }));
	const execFile = vi.fn((_file: string, args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
		if (args[0] === "run") {
			const name = args[args.indexOf("--name") + 1]!;
			if (docker.has(name)) {
				cb(dockerError(`Error response from daemon: Conflict. The container name "/${name}" is already in use`));
				return {};
			}
			docker.set(name, { id: "newcontainer1234", image: "new", ...faults.newContainer });
			cb(null, { stdout: "newcontainer1234\n", stderr: "" });
			return {};
		}
		cb(null, { stdout: "", stderr: "" });
		return {};
	});
	return { default: { execFileSync, execFile, spawnSync }, execFileSync, execFile, spawnSync };
});

import { resetQuickServiceProcessStateForTests, startService, updateService } from "../service";
import { containerHealthGate } from "../docker-cli";

const serviceRow = {
	id: "svc-1",
	slug: "demo",
	name: "Demo",
	category: "other",
	icon: "pkg",
	description: "Demo",
	image: "example/demo:latest",
	port: 18080,
	path: "/",
	envJson: "{}",
	volumesJson: "[]",
	internalPort: 8080,
	extraPortsJson: "[]",
	command: null,
	status: "running",
	instanceKey: "hub-host",
	serverId: null,
};

function oldContainerIsBackAndRunning() {
	expect([...docker.keys()]).toEqual(["qs-demo"]);
	expect(docker.get("qs-demo")).toMatchObject({ id: "oldcontainer0001", state: "running" });
}

beforeEach(() => {
	vi.clearAllMocks();
	resetQuickServiceProcessStateForTests();
	containerHealthGate.settleMs = 0;
	containerHealthGate.pollMs = 0;
	containerHealthGate.timeoutMs = 0;
	docker.clear();
	docker.set("qs-demo", { id: "oldcontainer0001", image: "old", state: "running", health: "", restarts: 0 });
	faults.inspectError = "";
	faults.renameError = "";
	faults.startError = "";
	faults.startLeaves = "running";
	faults.newContainer = { state: "running", health: "", restarts: 0 };
	prismaMock.quickService.findUnique.mockResolvedValue({ ...serviceRow });
	prismaMock.quickService.update.mockResolvedValue({});
});

describe("quick-service update keeps the previous container on failure", () => {
	it("replaces the container when the new one is up", async () => {
		await expect(updateService("demo")).resolves.toMatchObject({ status: "running" });
		expect([...docker.keys()]).toEqual(["qs-demo"]);
		expect(docker.get("qs-demo")).toMatchObject({ id: "newcontainer1234", state: "running" });
	});

	it("rolls back when the new container exits right after start", async () => {
		faults.newContainer = { state: "exited", health: "", restarts: 0 };
		await expect(updateService("demo")).rejects.toThrow(/启动后状态为 exited/);
		oldContainerIsBackAndRunning();
	});

	it("rolls back when the new container's healthcheck is unhealthy", async () => {
		faults.newContainer = { state: "running", health: "unhealthy", restarts: 0 };
		await expect(updateService("demo")).rejects.toThrow(/unhealthy/);
		oldContainerIsBackAndRunning();
	});

	it("rolls back when the new container is crash-looping", async () => {
		faults.newContainer = { state: "running", health: "", restarts: 2 };
		await expect(updateService("demo")).rejects.toThrow(/启动后立即重启了 2 次/);
		oldContainerIsBackAndRunning();
	});

	it("changes nothing when docker inspect fails for a reason other than 'no such container'", async () => {
		faults.inspectError = "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?";
		await expect(updateService("demo")).rejects.toThrow(/Cannot connect/);
		oldContainerIsBackAndRunning();
	});

	it("does not delete the current container when it cannot be renamed aside", async () => {
		faults.renameError = "Error response from daemon: Error when allocating new name: permission denied";
		await expect(updateService("demo")).rejects.toThrow(/无法保留当前容器用于回滚/);
		oldContainerIsBackAndRunning();
	});
});

describe("quick-service start only re-creates a container that is really gone", () => {
	it("does not recreate a started container when recording the new status fails", async () => {
		docker.get("qs-demo")!.state = "exited";
		prismaMock.quickService.update.mockRejectedValueOnce(new Error("database connection lost"));
		await expect(startService("demo")).rejects.toThrow(/database connection lost/);
		oldContainerIsBackAndRunning();
	});

	it("does not recreate a container that exists but fails to start", async () => {
		docker.get("qs-demo")!.state = "exited";
		faults.startError = "Error response from daemon: driver failed programming external connectivity: port is already allocated";
		await expect(startService("demo")).rejects.toThrow(/port is already allocated/);
		expect(docker.get("qs-demo")).toMatchObject({ id: "oldcontainer0001", state: "exited" });
		expect([...docker.keys()]).toEqual(["qs-demo"]);
	});

	it("reports a started container that exits at once as failed, not running", async () => {
		// `docker start` succeeds for a container whose process dies right away.
		docker.get("qs-demo")!.state = "exited";
		faults.startLeaves = "exited";
		await expect(startService("demo")).rejects.toThrow(/exited/);
		expect(prismaMock.quickService.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "running" }) }));
		expect(prismaMock.quickService.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "error" }) }));
	});

	it("re-creates the container when Docker says it does not exist", async () => {
		docker.clear();
		await expect(startService("demo")).resolves.toBeUndefined();
		expect(docker.get("qs-demo")).toMatchObject({ id: "newcontainer1234", state: "running" });
	});
});
