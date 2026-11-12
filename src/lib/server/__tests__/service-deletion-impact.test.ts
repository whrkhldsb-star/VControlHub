import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.hoisted(() => vi.fn(async (_model: string, _args?: unknown) => 0));
vi.mock("@/lib/db", () => ({
	prisma: new Proxy({}, {
		get: (_target, model) => model === "$queryRaw"
			? (async () => [])
			: model === "storageNode"
			? { findMany: vi.fn(async () => []) }
			: model === "playbook"
				? { findMany: vi.fn(async () => []) }
				: { count: (args: unknown) => count(String(model), args) },
	}),
}));

import { t as translate } from "@/lib/i18n/service-translations";

import { describeServerDeletionBlockers, getBlockingServerDeletionImpact, getServerDeletionImpact, type ServerDeletionImpact } from "../service-deletion-impact";

describe("server deletion impact", () => {
	beforeEach(() => count.mockReset().mockResolvedValue(0));

	it("names what still refers to the server in words, not by field name", () => {
		// The refusal read "…暂不能删除：files=120, fileVersions=3, unfinishedCommands=2。".
		const zh = (key: string, vars?: Record<string, string | number>) => translate(key, "zh", vars);
		const en = (key: string, vars?: Record<string, string | number>) => translate(key, "en", vars);
		expect(describeServerDeletionBlockers([["files", 120], ["fileVersions", 3], ["unfinishedCommands", 2]], zh)).toBe("文件 120 个、文件历史版本 3 个、未完成的命令 2 条");
		expect(describeServerDeletionBlockers([["files", 120], ["fileVersions", 3], ["unfinishedCommands", 2]], en)).toBe("files: 120, file versions: 3, unfinished commands: 2");

		// Every count that can block has its words in both languages.
		const all: ServerDeletionImpact = {
			storageNodes: 1, files: 1, fileVersions: 1, shares: 1, mediaItems: 1, scheduledTasks: 1, alertRules: 1, playbooks: 1,
			syncJobs: 1, quickServices: 1, backupSchedules: 1, backupRecords: 1, unfinishedCommands: 1, unfinishedDownloads: 1,
		};
		const everything = getBlockingServerDeletionImpact(all);
		expect(everything).toHaveLength(13);
		for (const say of [zh, en]) {
			const sentence = describeServerDeletionBlockers(everything, say);
			expect(sentence).not.toMatch(/backend\.|[a-z][A-Z]|=/);
		}
	});

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
