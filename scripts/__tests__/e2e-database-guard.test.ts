// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isDedicatedE2eDatabase, QA_USERNAME_PATTERN } from "../../e2e/helpers/isolated-account";

/**
 * `E2E_ISOLATED_ACCOUNT=1` (every `test:e2e:*` script but the plain one) creates an administrator whose password
 * is written in package.json, and removes rows by name pattern afterwards. The only check was that the database
 * is on loopback — which is where a production install keeps its own, with its `.env.local` in the directory the
 * suite is started from.
 */
describe("the database the e2e account may be created in", () => {
	const url = (name: string, host = "127.0.0.1") => `postgresql://app:secret@${host}:5432/${name}`;

	it("is one made for tests, by its name", () => {
		expect(isDedicatedE2eDatabase(url("vcontrolhub_test"), false)).toBe(true);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_e2e_test"), false)).toBe(true);
		expect(isDedicatedE2eDatabase(url("vch_audit_2026"), false)).toBe(true);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_test", "localhost"), false)).toBe(true);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_test", "[::1]"), false)).toBe(true);
	});

	it("is not the database of an installation, loopback or not", () => {
		expect(isDedicatedE2eDatabase(url("vcontrolhub"), false)).toBe(false);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_prod"), false)).toBe(false);
		expect(isDedicatedE2eDatabase(url("postgres"), false)).toBe(false);
		// The CI database only counts where CI says so.
		expect(isDedicatedE2eDatabase(url("vcontrolhub_ci"), false)).toBe(false);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_ci"), true)).toBe(true);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_ci_copy"), true)).toBe(false);
	});

	it("is never a remote one, whatever its name", () => {
		expect(isDedicatedE2eDatabase(url("vcontrolhub_test", "db.internal"), false)).toBe(false);
		expect(isDedicatedE2eDatabase(url("vcontrolhub_ci", "10.0.0.5"), true)).toBe(false);
	});

	it("removes only the accounts the suite names, not every name that starts the same way", () => {
		const pattern = new RegExp(QA_USERNAME_PATTERN);
		expect(pattern.test(`qa_${Date.now()}`)).toBe(true);
		expect(pattern.test("qa_team")).toBe(false);
		expect(pattern.test("qa_lead_zhang")).toBe(false);
		expect(pattern.test("xqa_1700000000000")).toBe(false);
	});
});
