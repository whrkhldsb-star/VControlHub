// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { serverFindUnique, writeAuditLogMock } = vi.hoisted(() => ({ serverFindUnique: vi.fn(), writeAuditLogMock: vi.fn(async (_entry: Record<string, unknown>) => undefined) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findUnique: serverFindUnique } } }));
vi.mock("@/lib/audit/service", () => ({ writeAuditLog: writeAuditLogMock }));

const { templateFromStoredService } = await import("../service-lifecycle");
const { SERVICE_CATALOG } = await import("../catalog");

const row = (overrides: Record<string, unknown> = {}) => ({
	slug: "emby", name: "Emby", category: "media", icon: "film", description: "", image: "emby/embyserver", port: 18096,
	internalPort: null as number | null, path: "/", envJson: "{}", volumesJson: "[]", extraPortsJson: "[]", command: null, ...overrides,
});

describe("templateFromStoredService (start after the container was removed, update)", () => {
	it("maps the chosen host port onto the container's own port, not onto itself", () => {
		// Installed as `-p 18096:8096`; rebuilt from the row alone it became `-p 18096:18096` and answered nowhere.
		const emby = SERVICE_CATALOG.find((entry) => entry.slug === "emby")!;
		expect(emby.internalPort).toBeUndefined();
		const template = templateFromStoredService(row());
		expect(template.internalPort).toBe(emby.defaultPort);
		expect(template.internalPort).not.toBe(18096);
	});

	it("keeps a container port the row stores, and falls back to the row for a service that is not built in", () => {
		expect(templateFromStoredService(row({ internalPort: 5000 })).internalPort).toBe(5000);
		const custom = templateFromStoredService(row({ slug: "from-an-app-source", port: 23456 }));
		expect(custom.internalPort).toBeUndefined();
		expect(custom.defaultPort).toBe(23456);
	});

	it("lets Portainer and Gladys be rebuilt with the Docker socket their catalog entry declares, and nobody else", () => {
		const withSocket = SERVICE_CATALOG.filter((entry) => entry.allowDockerSocket).map((entry) => entry.slug);
		expect(withSocket.length).toBeGreaterThan(0);
		for (const slug of withSocket) expect(templateFromStoredService(row({ slug })).allowDockerSocket).toBe(true);
		expect(templateFromStoredService(row({ slug: "emby" })).allowDockerSocket).toBeUndefined();
	});
});

describe("redactSnapshotForAudit", () => {
	it("keeps the names of the environment variables and drops their values", async () => {
		const { redactSnapshotForAudit } = await import("../service-internals");
		const redacted = redactSnapshotForAudit({ status: "running", image: "minio/minio", envJson: JSON.stringify({ MINIO_ROOT_USER: "admin", MINIO_ROOT_PASSWORD: "generated-secret" }) });
		expect(redacted).toEqual({ status: "running", image: "minio/minio", envJson: JSON.stringify({ MINIO_ROOT_USER: "***", MINIO_ROOT_PASSWORD: "***" }) });
		expect(JSON.stringify(redacted)).not.toContain("generated-secret");
		expect(redactSnapshotForAudit(null)).toBeNull();
		expect(redactSnapshotForAudit({ status: "stopped" })).toEqual({ status: "stopped" });
		// Not JSON: nothing to name, nothing leaks.
		expect(redactSnapshotForAudit({ envJson: "PASSWORD=hunter2" })).toEqual({ envJson: "{}" });
	});
});

describe("writeQuickServiceAudit customer", () => {
	it("stamps an entry about a service on a customer's server with that customer, and leaves hub-host entries to the platform", async () => {
		const { writeQuickServiceAudit } = await import("../service-internals");
		serverFindUnique.mockResolvedValueOnce({ teamId: "team-9" });
		await writeQuickServiceAudit({ instanceKey: "srv-1", action: "sync", slug: "minio", status: "started" });
		expect(serverFindUnique).toHaveBeenCalledWith({ where: { id: "srv-1" }, select: { teamId: true } });
		expect(writeAuditLogMock).toHaveBeenLastCalledWith(expect.objectContaining({ action: "quick_service.sync.started", teamId: "team-9" }));

		await writeQuickServiceAudit({ instanceKey: "hub-host", action: "sync", slug: "minio", status: "started" });
		expect(writeAuditLogMock.mock.calls.at(-1)![0]).not.toHaveProperty("teamId");
	});
});
