import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fake `systemctl` and `psql` for the restore runner tests, so they never
 * consult the real host (where the platform's own services may be running).
 *
 * - systemctl reports ActiveState FAKE_SYSTEMCTL_STATE (default "inactive")
 *   and LoadState FAKE_SYSTEMCTL_LOAD (default "loaded"); FAKE_SYSTEMCTL_FAIL=1
 *   makes it fail like a host whose systemd cannot be reached.
 * - psql answers the offline check query (`-c …`) with FAKE_PSQL_OTHER_CLIENTS
 *   (default 0); for an import it drains stdin, records argv and PGPASSWORD to
 *   RESTORE_CAPTURE when set, and fails with the offline error when
 *   FAKE_PSQL_OTHER_CLIENTS > 0, like the real in-transaction guard.
 */
const PSQL = `const fs = require("node:fs");
const args = process.argv.slice(2);
const others = Number(process.env.FAKE_PSQL_OTHER_CLIENTS || "0");
if (args.includes("-c")) { process.stdout.write(String(others) + "\\n"); process.exit(0); }
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  if (process.env.RESTORE_CAPTURE) fs.writeFileSync(process.env.RESTORE_CAPTURE, JSON.stringify({ args, password: process.env.PGPASSWORD, sql: Buffer.concat(chunks).toString("utf8").slice(0, 2000) }));
  if (others > 0) { process.stderr.write("ERROR:  OFFLINE RESTORE REQUIRED: " + others + " other client connection(s)\\n"); process.exit(3); }
  process.exit(0);
});
`;
const SYSTEMCTL = `const state = process.env.FAKE_SYSTEMCTL_STATE || "inactive";
const load = process.env.FAKE_SYSTEMCTL_LOAD || "loaded";
if (process.env.FAKE_SYSTEMCTL_FAIL === "1") { process.stderr.write("Failed to connect to bus\\n"); process.exit(1); }
if (process.argv[2] === "show") { process.stdout.write("LoadState=" + load + "\\nActiveState=" + state + "\\n"); process.exit(0); }
process.stdout.write(state + "\\n");
process.exit(state === "active" ? 0 : 3);
`;

export async function installFakeRestoreTools(dir: string, options: { psql?: boolean } = {}): Promise<string> {
  const bin = path.join(dir, "fake-bin");
  await mkdir(bin, { recursive: true });
  const tools = options.psql === false ? ([["systemctl", SYSTEMCTL]] as const) : ([["psql", PSQL], ["systemctl", SYSTEMCTL]] as const);
  for (const [name, source] of tools) {
    if (process.platform === "win32") {
      await writeFile(path.join(bin, `${name}.js`), source);
      await writeFile(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
    } else {
      await writeFile(path.join(bin, name), `#!${process.execPath}\n${source}`);
      await chmod(path.join(bin, name), 0o755);
    }
  }
  return bin;
}
