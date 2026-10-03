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
  it("deploy.sh keeps the lock inode and copies recovery credentials privately into its stage", () => {
    const sh = read("deploy.sh");
    expect(sh).toMatch(/umask 022/);
    expect(sh).toMatch(/release_deploy_lock/);
    expect(sh).not.toMatch(/rm -f "\$DEPLOY_LOCK"/);
    expect(sh).toMatch(/trap on_exit EXIT/);
    expect(sh).toContain('install -m 600 "$APP_DIR/$secret" "$stage_dir/$secret"');
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

  it("sandboxes the SSH WebSocket proxy without blocking outbound SSH", () => {
    const unit = read("deploy/systemd/vcontrolhub-ssh-ws.service.example");
    expect(unit).toMatch(/^PrivateDevices=true$/m);
    expect(unit).toMatch(/^ProtectKernelTunables=true$/m);
    expect(unit).toMatch(/^ProtectKernelModules=true$/m);
    expect(unit).toMatch(/^ProtectControlGroups=true$/m);
    expect(unit).toMatch(/^RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX$/m);
    expect(unit).toMatch(/^CapabilityBoundingSet=$/m);
  });
});
