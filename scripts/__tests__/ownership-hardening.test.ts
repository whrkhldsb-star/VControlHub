/**
 * Lightweight contract tests for ownership / deploy-lock hardening.
 * These assert the scripts still contain the anti-root-race guards without
 * requiring root to execute the full fix-ownership flow.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("ownership / deploy lock hardening", () => {
  it("deploy.sh forces umask 022 and cleans the flock lock file on EXIT", () => {
    const sh = read("deploy.sh");
    expect(sh).toMatch(/umask 022/);
    expect(sh).toMatch(/release_deploy_lock/);
    expect(sh).toMatch(/rm -f "\$DEPLOY_LOCK"/);
    expect(sh).toMatch(/trap on_exit EXIT/);
    // storage/ must be reclaimed — root agent probes write VPS archives there
    expect(sh).toMatch(/"\$APP_DIR\/storage"/);
    // source modes must be normalized (umask 077 leaves 600)
    expect(sh).toMatch(/find "\$APP_DIR\/src" -type f -exec chmod 644/);
    // secrets stay private
    expect(sh).toMatch(/chmod 600 "\$APP_DIR\/\$secret"/);
  });

  it("fix-ownership.sh is a root-run reclaim tool with dry-run + lock clear", () => {
    const sh = read("scripts/fix-ownership.sh");
    expect(sh).toMatch(/APP_USER="\$\{APP_USER:-vcontrolhub\}"/);
    expect(sh).toMatch(/--dry-run/);
    expect(sh).toMatch(/--clear-stale-deploy-lock/);
    expect(sh).toMatch(/chown -R "\$APP_USER:\$APP_USER"/);
    expect(sh).toMatch(/storage/);
    expect(sh).toMatch(/chmod 600/);
  });
});
