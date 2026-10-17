import { describe, expect, it } from "vitest";

import { parseSshTerminalKeepAlive, sshTerminalResumeStore } from "../ssh-terminal-keep-alive";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); },
	} as unknown as Storage;
}

describe("SSH terminal keep-alive preferences", () => {
	it("keeps sessions by default", () => {
		expect(parseSshTerminalKeepAlive(null)).toBe(true);
		expect(parseSshTerminalKeepAlive("0")).toBe(false);
	});

	it("remembers one resumable shell per server and only well-formed ids", () => {
		const storage = memoryStorage();
		const store = sshTerminalResumeStore("srv-1", () => storage);
		expect(store.load()).toBeNull();
		store.save("c".repeat(32));
		expect(store.load()).toBe("c".repeat(32));
		expect(sshTerminalResumeStore("srv-2", () => storage).load()).toBeNull();
		storage.setItem("ssh-terminal-resume:srv-1", "not-an-id");
		expect(store.load()).toBeNull();
		store.save(null);
		expect(storage.getItem("ssh-terminal-resume:srv-1")).toBeNull();
	});

	it("works without storage", () => {
		const store = sshTerminalResumeStore("srv-1", () => { throw new Error("blocked"); });
		expect(store.load()).toBeNull();
		expect(() => store.save("c".repeat(32))).not.toThrow();
	});
});
