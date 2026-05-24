import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, execSyncMock, execMock } = vi.hoisted(() => ({
	prismaMock: {
		quickService: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			upsert: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
	},
	execSyncMock: vi.fn(),
	execMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("child_process", () => ({
	default: { execFileSync: vi.fn(), execSync: execSyncMock, exec: execMock },
	execFileSync: vi.fn(),
	execSync: execSyncMock,
	exec: execMock,
}));

import { checkPort, installService, startService } from "../service";
import type { ServiceTemplate } from "../types";

const template: ServiceTemplate = {
	slug: "demo",
	name: "Demo",
	category: "other",
	icon: "📦",
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
		execSyncMock.mockReturnValue("");
		execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
			cb(null, { stdout: "abcdef1234567890\n", stderr: "" });
			return {};
		});
	});

	it("quotes docker arguments and stores running container id after install", async () => {
		prismaMock.quickService.upsert.mockResolvedValueOnce({ id: "svc-1", slug: "demo", port: 12345 });
		prismaMock.quickService.update.mockResolvedValueOnce({});

		const svc = await installService({ template, userId: "user-1", customPort: 12345 });

		expect(svc.port).toBe(12345);
		expect(execSyncMock).toHaveBeenCalledWith(expect.stringContaining("mkdir -p '/opt/demo/data'"), expect.any(Object));
		expect(execMock).toHaveBeenCalledWith(
			expect.stringContaining("docker run -d --name 'qs-demo'"),
			expect.objectContaining({ timeout: 300_000 }),
			expect.any(Function),
		);
		const dockerRun = execMock.mock.calls[0][0] as string;
		expect(dockerRun).toContain("-p 12345:12345");
		expect(dockerRun).toContain("-v '/opt/demo/data':'/data'");
		expect(dockerRun).toContain("-e DEMO_HOST='host.docker.internal'");
		expect(dockerRun).not.toContain("EMPTY");
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
			icon: "📦",
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
		execSyncMock.mockImplementationOnce(() => {
			throw new Error("missing container");
		});
		prismaMock.quickService.update.mockResolvedValue({});

		await startService("demo");

		const dockerRun = execMock.mock.calls[0][0] as string;
		expect(dockerRun).toContain("-p 18080:8080");
		expect(dockerRun).toContain("-p 19090:9090");
		expect(dockerRun).toContain("example/demo:latest serve --safe");
	});

	it("returns invalid for out-of-range port checks without shelling out", () => {
		expect(checkPort(70000)).toEqual({ available: false, usedBy: null });
		expect(execSyncMock).not.toHaveBeenCalled();
	});
});
