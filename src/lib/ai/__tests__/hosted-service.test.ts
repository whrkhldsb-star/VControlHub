import { describe, expect, it } from "vitest";

import { buildCommand } from "../hosted-service";

describe("AI hosted command builder", () => {
	it("quotes read_logs arguments and uses fixed-string filtering", () => {
		expect(
			buildCommand("read_logs", {
				logPath: "/var/log/nginx/access.log",
				tail: 120,
				filter: "error's",
			}),
		).toBe("tail -n 120 -- '/var/log/nginx/access.log' | grep -F -i -- 'error'\\''s'");
	});

	it("rejects command injection attempts in auto-approved read_logs", () => {
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog; touch /tmp/pwned", tail: 20 })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog", tail: "20; id" })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "/var/log/syslog", filter: "ok\nwhoami" })).toBeNull();
		expect(buildCommand("read_logs", { logPath: "../../etc/passwd", tail: 10 })).toBeNull();
	});
});
