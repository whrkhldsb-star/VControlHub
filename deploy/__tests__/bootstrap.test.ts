// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = path.resolve(__dirname, "../bootstrap.sh");

describe.skipIf(process.platform === "win32")("deploy/bootstrap.sh", () => {
  it("parses in bash", () => {
    const result = spawnSync("bash", ["-n", bootstrap], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([0, 23])("isolates cleanup of a fetched upgrade driver exiting with %i", async (exitCode) => {
    const app = await mkdtemp(path.join(tmpdir(), "vch-bootstrap-"));
    const scratch = path.join(app, "temporary drivers");
    try {
      await mkdir(path.join(app, ".git"));
      await mkdir(path.join(app, "deploy"));
      await mkdir(path.join(scratch, "sibling"), { recursive: true });
      await writeFile(path.join(app, "deploy/upgrade.sh"), "exit 99\n", { mode: 0o755 });

      const harness = `
        id() { echo 0; }
        git() {
          case " $* " in
            *" fetch "*) return 0 ;;
            *" show FETCH_HEAD:deploy/upgrade.sh "*) printf '%s\\n' 'echo "$0"' 'exit "$1"' ;;
            *) return 98 ;;
          esac
        }
        fetched_dir="$TMPDIR/sibling"
        trap 'echo "$fetched_dir" > "$APP_DIR/outer-cleanup"' EXIT
        source "$1" "$2"
      `;
      const result = spawnSync("bash", ["-c", harness, "bash", bootstrap, String(exitCode)], {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH, APP_DIR: app, TMPDIR: scratch, VCONTROLHUB_ACTION: "update" },
      });

      expect(result.status, result.stderr).toBe(exitCode);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(scratch + path.sep);
      expect(await readdir(scratch)).toEqual(["sibling"]);
      expect((await readFile(path.join(app, "outer-cleanup"), "utf8")).trim()).toBe(path.join(scratch, "sibling"));
    } finally {
      await rm(app, { recursive: true, force: true });
    }
  });
});
