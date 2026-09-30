import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Build tools fork TypeScript workers. Use NODE_OPTIONS so their children
// receive the same heap budget on Linux, Windows and inside image builds.
const [entry, ...args] = process.argv.slice(2);
if (!entry) throw new Error("A Node build tool entry point is required");
const env = { ...process.env };
if (!/--max[-_]old[-_]space[-_]size(?:=|\s)/.test(env.NODE_OPTIONS ?? "")) {
  const heap = Number(env.VCONTROLHUB_BUILD_HEAP_MB ?? 4096);
  if (!Number.isSafeInteger(heap) || heap < 1024 || heap > 32768) {
    throw new Error("VCONTROLHUB_BUILD_HEAP_MB must be an integer from 1024 to 32768");
  }
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --max-old-space-size=${heap}`.trim();
}
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve(entry), ...args], { env, stdio: "inherit" });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
