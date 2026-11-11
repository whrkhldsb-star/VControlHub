import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

const RESPONSE_CONSUMER_FILES = [
	// reads the status (422, 502) and the body of the probe's answer
	"src/app/backups/offsite-dry-run-button.tsx",
	// system export returns a downloadable body; must use raw:true (not auto-parsed JSON)
	"src/app/settings/system-config-section.tsx",
] as const;

/**
 * These used to take the raw Response only to check `ok` and throw "status=403" / "HTTP 500", which threw
 * away the reason the server had given. They read the parsed body now: a refusal reaches them as an ApiError
 * that carries the server's message.
 */
const PARSED_BODY_FILES = [
	"src/app/ai-ops/ai-ops-page-client.tsx",
	"src/app/cost-summary/use-cost-page-state.ts",
] as const;

function rawModeCallCount(source: string): number {
	return (source.match(/csrfFetch(?:<[^>]+>)?\([\s\S]*?raw:\s*true[\s\S]*?\)/gu) ?? []).length;
}

describe("csrfFetch Response consumers", () => {
	it("opts into raw mode for call sites that inspect Response status or body", () => {
		const counts = Object.fromEntries(
			RESPONSE_CONSUMER_FILES.map((relativePath) => {
				const source = readFileSync(join(repoRoot, relativePath), "utf8");
				return [relativePath, rawModeCallCount(source)];
			}),
		);

		expect(counts).toEqual({
			"src/app/backups/offsite-dry-run-button.tsx": 1,
			"src/app/settings/system-config-section.tsx": 1,
		});
	});

	it("does not take the raw Response where only the parsed body is used", () => {
		for (const relativePath of PARSED_BODY_FILES) {
			const source = readFileSync(join(repoRoot, relativePath), "utf8");
			expect(rawModeCallCount(source), relativePath).toBe(0);
			expect(source, relativePath).not.toMatch(/csrfFetch<Response>/u);
			// A status turned into the message is what hid the server's reason.
			expect(source, relativePath).not.toMatch(/`(?:status=|HTTP )\$\{/u);
		}
	});
});
