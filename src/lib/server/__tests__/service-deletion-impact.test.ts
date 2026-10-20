import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.hoisted(() => vi.fn(async (_model: string, _args?: unknown) => 0));
vi.mock("@/lib/db", () => ({
	prisma: new Proxy({}, {
		get: (_target, model) => model === "storageNode"
			? { findMany: vi.fn(async () => []) }
			: model === "playbook"
				? { findMany: vi.fn(async () => []) }
				: { count: (args: unknown) => count(String(model), args) },
	}),
}));

import { getBlockingServerDeletionImpact, getServerDeletionImpact } from "../service-deletion-impact";

describe("server deletion impact", () => {
	beforeEach(() => count.mockReset().mockResolvedValue(0));

	it("blocks deleting a server while a command or download still runs against it", async () => {
		// Their rows went with the server by cascade: a running command lost its
		// targets and a running download its task, while both carried on.
		count.mockImplementation(async (model: string) => (model === "commandTarget" || model === "downloadTask" ? 1 : 0));

		const impact = await getServerDeletionImpact("srv_1");

		expect(impact).toMatchObject({ unfinishedCommands: 1, unfinishedDownloads: 1 });
		expect(getBlockingServerDeletionImpact(impact).map(([name]) => name).sort()).toEqual(["unfinishedCommands", "unfinishedDownloads"]);
		expect(count).toHaveBeenCalledWith("commandTarget", { where: { serverId: "srv_1", status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"] } } });
	});
});
