// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The key check is a gate: a key that no dictionary has is shown to people as the key itself. It used to look
 * at `t("…")` only, so the remote-desktop probe answered "apiCopy.server.not.found.b3aa1f7c" for a server that
 * does not exist — the key went through `apiCopy()`. Run against a fixture, every translator the code base
 * uses must be read.
 */
const repo = path.resolve(".");
const tsxCli = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");

describe.skipIf(!existsSync(tsxCli))("i18n:key-check gate", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), "vch-i18n-keys-"));
		mkdirSync(path.join(root, "src", "lib", "i18n", "dictionaries"), { recursive: true });
		writeFileSync(
			path.join(root, "src", "lib", "i18n", "dictionaries", "fixture.ts"),
			`export const zh: Record<string, string> = {\n\t"fixture.known": "已知",\n};\nexport const en: Record<string, string> = {\n\t"fixture.known": "Known",\n};\n`,
		);
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const run = () =>
		spawnSync(process.execPath, [tsxCli, path.join(repo, "scripts", "i18n-key-completeness.ts")], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, I18N_KEY_CHECK_ROOT: root },
		});
	const source = (body: string) => writeFileSync(path.join(root, "src", "code.ts"), body);

	it("passes when every key that is asked for exists", () => {
		source(`export const a = t("fixture.known");\nexport const b = apiCopy("fixture.known");\n`);
		const result = run();
		expect(result.status, result.stderr).toBe(0);
	});

	it.each([
		["t", `t("fixture.missing")`],
		["apiCopy", `apiCopy("fixture.missing")`],
		["tr (a Server Action's translator)", `tr("fixture.missing", { name })`],
		["tt", `tt("fixture.missing")`],
		["browserT", `browserT("fixture.missing", locale)`],
		["serviceT", `serviceT("fixture.missing")`],
		["translate", `translate("fixture.missing", locale)`],
		["a translator kept in a ref", `tRef.current("fixture.missing")`],
		["tplT", `tplT("fixture.missing")`],
	])("fails on a key no dictionary has, asked for through %s", (_name, call) => {
		source(`export const text = ${call};\n`);
		const result = run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("fixture.missing");
	});

	it("does not take a string in a comment or another function's argument for a key", () => {
		source(`// t("fixture.missing")\nexport const action = audit("fixture.missing");\nexport const known = t("fixture.known");\n`);
		const result = run();
		expect(result.status, result.stderr).toBe(0);
	});
});

/**
 * CI runs the test job, not `npm run verify`, so the gate never looked at the code base there: a key missing
 * from the dictionaries, or present in one language only, could reach main with every required check green.
 */
describe.skipIf(!existsSync(tsxCli))("the code base's own keys", () => {
	it("all resolve in both languages", () => {
		const env = { ...process.env };
		delete env.I18N_KEY_CHECK_ROOT;
		const result = spawnSync(process.execPath, [tsxCli, path.join(repo, "scripts", "i18n-key-completeness.ts")], {
			cwd: repo,
			encoding: "utf8",
			env,
		});
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
	});
});
