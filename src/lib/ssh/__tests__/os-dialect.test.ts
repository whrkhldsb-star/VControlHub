/**
 * Unit tests for OS Dialect abstraction layer (TR-041)
 */
import { describe, it, expect } from "vitest";

import {
  parseOsRelease,
  dialectFromOsRelease,
  serviceCommand,
  packageCommand,
  serializeDialect,
  deserializeDialect,
  DEFAULT_DIALECT,
  type OsDialect,
} from "../os-dialect";

// Helper: build a full OsDialect from a base with overrides
function makeDialect(overrides: Partial<OsDialect>): OsDialect {
  return { ...DEFAULT_DIALECT, ...overrides };
}

describe("parseOsRelease", () => {
  it("parses standard Debian os-release", () => {
    const content = `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"`;
    const result = parseOsRelease(content);
    expect(result.id).toBe("debian");
    expect(result.name).toBe("Debian GNU/Linux");
    expect(result.version).toBe("12 (bookworm)");
    expect(result.prettyName).toBe("Debian GNU/Linux 12 (bookworm)");
    expect(result.idLike).toBe("");
  });

  it("parses Ubuntu with ID_LIKE", () => {
    const content = `NAME="Ubuntu"
VERSION="22.04.3 LTS (Jammy Jellyfish)"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 22.04.3 LTS"`;
    const result = parseOsRelease(content);
    expect(result.id).toBe("ubuntu");
    expect(result.idLike).toBe("debian");
    expect(result.prettyName).toBe("Ubuntu 22.04.3 LTS");
  });

  it("parses Alpine Linux", () => {
    const content = `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.19
PRETTY_NAME="Alpine Linux v3.19"`;
    const result = parseOsRelease(content);
    expect(result.id).toBe("alpine");
    expect(result.prettyName).toBe("Alpine Linux v3.19");
  });

  it("handles empty input", () => {
    const result = parseOsRelease("");
    expect(result.id).toBe("");
    expect(result.name).toBe("");
  });

  it("handles unquoted values", () => {
    const content = "ID=fedora\nVERSION=39";
    const result = parseOsRelease(content);
    expect(result.id).toBe("fedora");
    expect(result.version).toBe("39");
  });
});

describe("dialectFromOsRelease", () => {
  it("matches Debian", () => {
    const info = parseOsRelease(`ID=debian\nNAME="Debian GNU/Linux"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("debian");
    expect(dialect.packageManager).toBe("apt");
    expect(dialect.serviceManager).toBe("systemd");
  });

  it("matches Ubuntu via ID_LIKE", () => {
    const info = parseOsRelease(`ID=ubuntu\nID_LIKE=debian\nNAME="Ubuntu"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("debian");
    expect(dialect.packageManager).toBe("apt");
  });

  it("matches RHEL", () => {
    const info = parseOsRelease(`ID=rhel\nNAME="Red Hat Enterprise Linux"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("rhel");
    expect(dialect.packageManager).toBe("dnf");
    expect(dialect.serviceManager).toBe("systemd");
  });

  it("matches CentOS", () => {
    const info = parseOsRelease(`ID=centos\nNAME="CentOS Linux"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("rhel");
    expect(dialect.packageManager).toBe("dnf");
  });

  it("matches Alpine", () => {
    const info = parseOsRelease(`ID=alpine\nNAME="Alpine Linux"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("alpine");
    expect(dialect.packageManager).toBe("apk");
    expect(dialect.serviceManager).toBe("openrc");
  });

  it("matches Arch", () => {
    const info = parseOsRelease(`ID=arch\nNAME="Arch Linux"`);
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("arch");
    expect(dialect.packageManager).toBe("pacman");
    expect(dialect.serviceManager).toBe("systemd");
  });

  it("falls back to Debian for unknown distro", () => {
    const info = parseOsRelease(`ID=unknown\nNAME="Unknown OS"`);
    const dialect = dialectFromOsRelease(info);
    // Fallback is Debian preset (backward compatible)
    expect(dialect.distroFamily).toBe("debian");
    expect(dialect.packageManager).toBe("apt");
    expect(dialect.serviceManager).toBe("systemd");
    expect(dialect.distroName).toBe("Unknown OS");
  });

  it("falls back to Debian for empty input", () => {
    const info = parseOsRelease("");
    const dialect = dialectFromOsRelease(info);
    expect(dialect.distroFamily).toBe("debian");
    expect(dialect.packageManager).toBe("apt");
  });
});

describe("serviceCommand", () => {
  it("generates systemd restart with sudo", () => {
    const cmd = serviceCommand("systemd", "restart", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n systemctl restart nginx");
  });

  it("generates systemd status without sudo", () => {
    const cmd = serviceCommand("systemd", "status", "nginx", "sudo -n");
    expect(cmd).toBe("systemctl status nginx --no-pager -l");
  });

  it("generates systemd reload with restart fallback", () => {
    const cmd = serviceCommand("systemd", "reload", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n systemctl reload nginx || sudo -n systemctl restart nginx");
  });

  it("generates openrc restart", () => {
    const cmd = serviceCommand("openrc", "restart", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n rc-service nginx restart");
  });

  it("generates openrc status without sudo", () => {
    const cmd = serviceCommand("openrc", "status", "nginx", "sudo -n");
    expect(cmd).toBe("rc-service nginx status");
  });

  it("generates openrc reload (action passed through)", () => {
    const cmd = serviceCommand("openrc", "reload", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n rc-service nginx reload");
  });

  it("generates sysvinit restart using service command", () => {
    const cmd = serviceCommand("sysvinit", "restart", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n service nginx restart");
  });

  it("generates sysvinit status without sudo", () => {
    const cmd = serviceCommand("sysvinit", "status", "nginx", "sudo -n");
    expect(cmd).toBe("service nginx status");
  });

  it("generates openrc enable using rc-update", () => {
    const cmd = serviceCommand("openrc", "enable", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n rc-update add nginx default");
  });

  it("generates sysvinit enable using update-rc.d", () => {
    const cmd = serviceCommand("sysvinit", "enable", "nginx", "sudo -n");
    expect(cmd).toBe("sudo -n update-rc.d nginx enable");
  });
});

describe("packageCommand", () => {
  it("generates apt install", () => {
    const cmd = packageCommand("apt", "install", ["nginx"], "sudo -n");
    expect(cmd).toBe("sudo -n apt-get install -y nginx");
  });

  it("generates apt update", () => {
    const cmd = packageCommand("apt", "update", [], "sudo -n");
    expect(cmd).toBe("sudo -n apt-get update");
  });

  it("generates apt upgrade (includes update)", () => {
    const cmd = packageCommand("apt", "upgrade", [], "sudo -n");
    expect(cmd).toBe("sudo -n apt-get update && sudo -n apt-get upgrade -y");
  });

  it("generates dnf install", () => {
    const cmd = packageCommand("dnf", "install", ["nginx"], "sudo -n");
    expect(cmd).toBe("sudo -n dnf install -y nginx");
  });

  it("generates apk add", () => {
    const cmd = packageCommand("apk", "install", ["nginx"], "sudo -n");
    expect(cmd).toBe("sudo -n apk add nginx");
  });

  it("generates pacman install", () => {
    const cmd = packageCommand("pacman", "install", ["nginx"], "sudo -n");
    expect(cmd).toBe("sudo -n pacman -S --noconfirm nginx");
  });
});

describe("serializeDialect / deserializeDialect", () => {
  it("serializes and deserializes correctly", () => {
    const dialect = makeDialect({ distroName: "Debian 12" });
    const json = serializeDialect(dialect);
    expect(typeof json).toBe("string");
    const restored = deserializeDialect(json);
    expect(restored.packageManager).toBe("apt");
    expect(restored.serviceManager).toBe("systemd");
    expect(restored.distroName).toBe("Debian 12");
  });

  it("deserializeDialect returns default for null", () => {
    const dialect = deserializeDialect(null);
    expect(dialect.packageManager).toBe("apt");
    expect(dialect.serviceManager).toBe("systemd");
    // Default is Debian-based
    expect(dialect.distroFamily).toBe("debian");
  });

  it("deserializeDialect returns default for invalid JSON", () => {
    const dialect = deserializeDialect("not valid json");
    expect(dialect.packageManager).toBe("apt");
    expect(dialect.serviceManager).toBe("systemd");
  });

  it("DEFAULT_DIALECT has required fields", () => {
    expect(DEFAULT_DIALECT.packageManager).toBeTruthy();
    expect(DEFAULT_DIALECT.serviceManager).toBeTruthy();
    expect(DEFAULT_DIALECT.distroFamily).toBeTruthy();
    expect(DEFAULT_DIALECT.sudoPattern).toBeTruthy();
    expect(DEFAULT_DIALECT.configPaths).toBeDefined();
    expect(typeof DEFAULT_DIALECT.configPaths.nginx).toBe("string");
  });

  it("deserializeDialect merges parsed fields over defaults", () => {
    const custom = makeDialect({ packageManager: "apk", serviceManager: "openrc", distroFamily: "alpine" });
    const json = serializeDialect(custom);
    const restored = deserializeDialect(json);
    expect(restored.packageManager).toBe("apk");
    expect(restored.serviceManager).toBe("openrc");
    expect(restored.distroFamily).toBe("alpine");
  });
});
