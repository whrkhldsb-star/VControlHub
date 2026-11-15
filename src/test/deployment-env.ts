import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The configuration an installation sets through its environment.
 *
 * A test run inherits the shell's variables. Started in a shell with a deployment's variables exported
 * (AUTH_SESSION_SECRET, TRUSTED_PROXY_HOPS, …), 17 tests of sessions, the share page and image upload failed
 * that pass in CI, where none of them is set. The setup clears these before each test file; a test that needs
 * one sets it itself (`vi.stubEnv`).
 *
 * The list is read from what documents and reads the configuration, so a new variable is covered without
 * being added here: every key `.env.example` names, and every variable `src/lib/config/env.ts` reads.
 */
const READERS = /\bread(?:String|OptionalString|Int|Float|Bool|List)\(\s*"([A-Z][A-Z0-9_]+)"/g;

/** Read with `process.env` outside the config module. */
const ALSO_CONFIGURATION = ["AUTH_SECRET", "DOMAIN", "NEXT_PUBLIC_APP_URL", "ARIA2_MANAGED_EXTERNALLY", "VCONTROLHUB_RUNTIME_ENV_LOADED"];

/** Kept: the database the integration tests are pointed at, and what Vitest itself sets. */
export const KEPT_ENV_KEYS: ReadonlySet<string> = new Set(["DATABASE_URL", "NODE_ENV", "VITEST"]);

export function deploymentEnvKeys(root = process.cwd()): Set<string> {
	const keys = new Set<string>(ALSO_CONFIGURATION);
	for (const match of readFileSync(join(root, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) keys.add(match[1]!);
	for (const match of readFileSync(join(root, "src", "lib", "config", "env.ts"), "utf8").matchAll(READERS)) keys.add(match[1]!);
	for (const key of KEPT_ENV_KEYS) keys.delete(key);
	return keys;
}

/** Remove the deployment's configuration from `env`; returns the names that were set. */
export function clearDeploymentEnv(env: NodeJS.ProcessEnv = process.env, keys: Iterable<string> = deploymentEnvKeys()): string[] {
	const cleared: string[] = [];
	for (const key of keys) {
		if (env[key] === undefined) continue;
		delete env[key];
		cleared.push(key);
	}
	return cleared;
}
