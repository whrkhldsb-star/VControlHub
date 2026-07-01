import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

const RESPONSE_CONSUMER_FILES = [
	"src/app/ai-ops/ai-ops-page-client.tsx",
	"src/app/cost-summary/cost-page-client.tsx",
	"src/app/backups/offsite-dry-run-button.tsx",
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
			"src/app/ai-ops/ai-ops-page-client.tsx": 6,
			"src/app/cost-summary/cost-page-client.tsx": 6,
			"src/app/backups/offsite-dry-run-button.tsx": 1,
		});
	});
});
