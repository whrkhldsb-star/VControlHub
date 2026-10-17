// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { HOST_FACTS_SCRIPT, parseHostFacts } from "../host-facts";

describe("host facts", () => {
	it("parses the system section", () => {
		expect(parseHostFacts([
			"arch=x86_64",
			"kernel=6.8.0-45-generic",
			"os=Ubuntu 24.04.1 LTS",
			"cpu=Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
			"virt=kvm",
			"procs=153",
			"tcp=42",
			"udp=7",
		])).toEqual({
			arch: "x86_64",
			kernel: "6.8.0-45-generic",
			os: "Ubuntu 24.04.1 LTS",
			cpuModel: "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz",
			virtualization: "kvm",
			processes: 153,
			tcpConnections: 42,
			udpConnections: 7,
		});
	});

	it("keeps unknown values null and treats the text as untrusted", () => {
		const facts = parseHostFacts([
			"arch=",
			"kernel=6.1; rm -rf /",
			"os=\u001b[31mEvil\u0007 OS" + "x".repeat(200),
			"cpu=",
			"virt=None",
			"procs=-3",
			"tcp=12abc",
			"udp=999999999999",
		]);
		expect(facts).toEqual({
			arch: null,
			kernel: null,
			os: expect.stringMatching(/^\[31mEvil OSx+$/),
			cpuModel: null,
			virtualization: "none",
			processes: null,
			tcpConnections: null,
			udpConnections: null,
		});
		expect(facts!.os!.length).toBeLessThanOrEqual(96);
	});

	it("is absent when the section is", () => {
		expect(parseHostFacts([])).toBeUndefined();
		expect(parseHostFacts(["garbage"])).toBeUndefined();
	});

	it.skipIf(process.platform === "win32")("runs under a POSIX shell and reports this host", () => {
		const output = execFileSync("/bin/sh", ["-c", HOST_FACTS_SCRIPT], { encoding: "utf8" });
		const lines = output.split("\n");
		expect(lines[0]).toBe("===SYS===");
		const facts = parseHostFacts(lines.slice(1));
		expect(facts?.arch).toMatch(/^[A-Za-z0-9_.-]+$/);
		expect(facts?.kernel).not.toBeNull();
		expect(facts?.processes).toBeGreaterThan(0);
		expect(facts?.tcpConnections).not.toBeNull();
	});
});
