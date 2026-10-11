import { describe, expect, it } from "vitest";

import { pickPreferredStorageNode } from "../preferred-node";

describe("pickPreferredStorageNode", () => {
	it("skips a node that is known to be unreachable, even when it is the newest", () => {
		const nodes = [
			{ id: "draft", healthStatus: "UNHEALTHY" },
			{ id: "local", healthStatus: "HEALTHY" },
		];
		expect(pickPreferredStorageNode(nodes)?.id).toBe("local");
	});

	it("prefers the default node when it is usable", () => {
		const nodes = [
			{ id: "other", healthStatus: "UNKNOWN" },
			{ id: "main", isDefault: true, healthStatus: "HEALTHY" },
		];
		expect(pickPreferredStorageNode(nodes)?.id).toBe("main");
	});

	it("falls back to the first node when none is known to be usable", () => {
		expect(pickPreferredStorageNode([{ id: "a", healthStatus: "UNHEALTHY" }, { id: "b", healthStatus: "UNHEALTHY" }])?.id).toBe("a");
		expect(pickPreferredStorageNode([])).toBeUndefined();
	});
});
