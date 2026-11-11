import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every long-running process shares the service code, and that code hands
 * rows with BigInt columns (file sizes, traffic counters) to JSON.stringify:
 * job results, bus messages, API bodies. It only works where the BigInt JSON
 * patch is loaded. The web process loads it from the instrumentation hook;
 * a process with its own entry file has to import it itself, before the
 * modules that may serialize while they load.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const firstImport = (source: string) => /^import\s[^;]*;/m.exec(source)?.[0];

describe("BigInt JSON patch in every process", () => {
	it.each(["src/worker.ts", "src/ssh-ws-proxy.ts"])("%s imports it first", (file) => {
		expect(firstImport(read(file))).toBe('import "@/lib/bigint-patch";');
	});

	it("the web process loads it from the instrumentation hook", () => {
		expect(read("src/instrumentation-node.ts")).toContain('await import("./lib/bigint-patch")');
	});
});
