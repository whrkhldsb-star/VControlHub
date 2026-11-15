import { describe, expect, it } from "vitest";

import { browserT } from "@/lib/i18n/browser-translations";
import { nodeErrorText } from "../node-error";

const zh = (key: string, vars?: Record<string, string | number>) => browserT(key, "zh", vars);
const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);

describe("nodeErrorText", () => {
	// The collector's English sentence was shown as it was on a Chinese page: "Network unreachable: ECONNREFUSED".
	it("says what failed in the page's language and keeps the system's reason", () => {
		const offline = { error: "Network unreachable: ECONNREFUSED", errorKind: "network" as const, errorDetail: "ECONNREFUSED" };
		expect(nodeErrorText(offline, zh)).toBe("网络不通：ECONNREFUSED");
		expect(nodeErrorText(offline, en)).toBe("Network unreachable: ECONNREFUSED");
		const ssh = { error: "SSH unreachable (host online, RTT 12ms): auth failed", errorKind: "ssh" as const, errorDetail: "auth failed", latencyMs: 12 };
		expect(nodeErrorText(ssh, zh)).toBe("主机在线（往返 12 毫秒），但 SSH 连不上：auth failed");
	});

	it("names an unknown reason, and shows an error it cannot sort as it is", () => {
		expect(nodeErrorText({ error: "Network unreachable: unknown reason", errorKind: "network" }, zh)).toBe("网络不通：原因不明");
		expect(nodeErrorText({ error: "something else" }, zh)).toBe("something else");
		expect(nodeErrorText({}, zh)).toBeNull();
	});
});
