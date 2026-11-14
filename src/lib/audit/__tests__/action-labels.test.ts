// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { en, zh } from "@/lib/i18n/dictionaries/audit";

/**
 * Every action the platform writes to the audit log has a label in both languages. The audit page, its filters,
 * its "most frequent actions" panel and the dashboard show `audit.action.<action>`, and fall back to the code:
 * 99 of the 192 actions written read "alert_rule.create", "ai.provider.delete" or "snippet.delete" there.
 */
const SRC_ROOT = join(process.cwd(), "src");

function collectFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) collectFiles(path, out);
		else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
	}
	return out;
}

/** The text of the call's argument at `index` (0-based), from the character after its opening parenthesis. */
function argumentAt(source: string, start: number, index: number): string {
	let depth = 0;
	let current = 0;
	let from = start;
	let quote: string | null = null;
	for (let at = start; at < source.length; at++) {
		const char = source[at]!;
		if (quote) {
			if (char === "\\") at++;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === "\"" || char === "'" || char === "`") quote = char;
		else if ("([{".includes(char)) depth++;
		else if (")]}".includes(char)) {
			if (depth === 0) return current === index ? source.slice(from, at) : "";
			depth--;
		} else if (char === "," && depth === 0) {
			if (current === index) return source.slice(from, at);
			current++;
			from = at + 1;
		}
	}
	return "";
}

/** Action codes written as string literals in an expression — one, or the branches of a conditional. */
function literalCodes(expression: string): string[] {
	return [...expression.matchAll(/["'`]([a-z][\w-]*(?:\.[\w-]+)+)["'`]/g)].map((match) => match[1]!);
}

// Actions built from a value: the values come from the request schema or type named beside them.
const COMPUTED: Record<string, string[]> = {
	// src/app/api/docker/containers/route.ts: action z.enum(["start", "stop", "restart", "remove"]).
	"docker.container.${action}": ["start", "stop", "restart", "remove"].map((action) => `docker.container.${action}`),
	// src/app/api/docker/compose/route.ts: action z.enum(["ps", "up", "down", "start", "stop", "restart"]), and ".failed".
	"docker.compose.${body.action}": ["ps", "up", "down", "start", "stop", "restart"].map((action) => `docker.compose.${action}`),
	"docker.compose.${body.action}.failed": ["ps", "up", "down", "start", "stop", "restart"].map((action) => `docker.compose.${action}.failed`),
	// src/app/api/docker/resources/route.ts: networks or volumes, action z.enum(["create", "delete"]).
	"docker.${isNetwork ? \"network\" : \"volume\"}.${action}": ["network", "volume"].flatMap((kind) => ["create", "delete"].map((action) => `docker.${kind}.${action}`)),
	// src/lib/public-status/nodes-admin.ts: the batch action enum.
	"public_status.nodes.${body.action}": ["publish", "publish_named", "unpublish", "maintenance_on", "maintenance_off"].map((action) => `public_status.nodes.${action}`),
	// src/lib/quick-service/service-internals.ts: QuickServiceAuditInput's action and status.
	"quick_service.${input.action}.${input.status}": ["install", "start", "stop", "sync", "update", "uninstall"].flatMap((action) => ["started", "succeeded", "failed"].map((status) => `quick_service.${action}.${status}`)),
};

// Actions passed through a variable: the file that passes them names them as literals.
const THROUGH_VARIABLES: Record<string, RegExp> = {
	[join("src", "ssh-ws-proxy.ts")]: /["'](server\.ssh\.\w+)["']/g,
	[join("src", "lib", "rdp", "ws.ts")]: /\baudit\(["'](server\.rdp\.\w+)["']/g,
	[join("src", "lib", "playbook", "trigger-service.ts")]: /recordTriggerAudit\(["'](playbook\.trigger\.\w+)["']/g,
	[join("src", "app", "api", "admin", "public-status", "nodes", "[serverId]", "route.ts")]: /["'](public_status\.node\.\w+)["']/g,
};

function writtenActions(): Map<string, string> {
	const actions = new Map<string, string>();
	const unknown: string[] = [];
	const add = (code: string, file: string) => { if (!actions.has(code)) actions.set(code, file); };
	for (const file of collectFiles(SRC_ROOT)) {
		const source = readFileSync(file, "utf8");
		const name = relative(process.cwd(), file);
		if (name === join("src", "lib", "audit", "service.ts")) continue;
		for (const [pattern, index] of [[/\bauditUserAction\(/g, 1], [/\bauditSystemAction\(/g, 0]] as const) {
			for (const match of source.matchAll(pattern)) {
				const argument = argumentAt(source, match.index! + match[0].length, index).trim();
				if (argument.includes("${")) {
					const computed = COMPUTED[argument.slice(1, -1)];
					if (computed) computed.forEach((code) => add(code, name));
					else unknown.push(`${name}: ${argument}`);
				} else if (/^[A-Za-z_]\w*$/.test(argument)) {
					// A variable: its values are collected below.
				} else {
					const codes = literalCodes(argument);
					if (codes.length === 0) unknown.push(`${name}: ${argument}`);
					codes.forEach((code) => add(code, name));
				}
			}
		}
		for (const match of source.matchAll(/\bwriteAuditLog\(\{[\s\S]*?\baction:\s*([^,\n]+)/g)) {
			const argument = match[1]!.trim();
			const computed = COMPUTED[argument.slice(1, -1)];
			if (computed) computed.forEach((code) => add(code, name));
			else literalCodes(argument).forEach((code) => add(code, name));
		}
		const through = THROUGH_VARIABLES[name];
		if (through) {
			const codes = [...source.matchAll(through)].map((match) => match[1]!);
			if (codes.length === 0) unknown.push(`${name}: no action found where the test expects them`);
			codes.forEach((code) => add(code, name));
		}
	}
	expect(unknown, "an audit action built in a way this test cannot read: list its values in COMPUTED").toEqual([]);
	return actions;
}

describe("audit action labels", () => {
	const actions = writtenActions();

	it("finds the actions the platform writes", () => {
		expect(actions.size).toBeGreaterThan(190);
		for (const code of ["auth.login_password_ok", "alert_rule.create", "server.ssh.connected", "server.rdp.connected", "playbook.trigger.cron", "public_status.node.publish", "quick_service.install.failed", "docker.compose.up"]) {
			expect(actions.has(code), code).toBe(true);
		}
	});

	it("gives every action a label in both languages", () => {
		const missing = [...actions].filter(([code]) => !zh[`audit.action.${code}`] || !en[`audit.action.${code}`]).map(([code, file]) => `${code} (${file})`);
		expect(missing).toEqual([]);
	});
});
