import { describe, expect, it } from "vitest";
import {
  classifyCommandRisk,
  classifyCommandRiskForTargets,
  COMMAND_RISK_CLASSIFIER_VERSION,
} from "../risk-classifier";
import { maskCommandOutput } from "../output-masker";

describe("classifyCommandRisk", () => {
  it("classifies safe POSIX read-only commands and read-only pipelines as low", () => {
    for (const cmd of [
      "ls -la /var/log",
      "df -h",
      "free -m",
      "uptime",
      "systemctl status nginx",
      "docker ps -a",
      "docker logs --tail 50 web",
      "ps aux | grep nginx | head -n 5",
      "cat /var/log/syslog 2>/dev/null | tail -n 20",
      "find /var/log -name '*.log'",
    ]) {
      const result = classifyCommandRisk(cmd, "LINUX");
      expect(result.level, `expected low for: ${cmd}`).toBe("low");
      expect(result.denylisted).toBe(false);
      expect(result.version).toBe(COMMAND_RISK_CLASSIFIER_VERSION);
    }
  });

  it("classifies standard utilities like nginx -t and systemctl reload as medium", () => {
    expect(classifyCommandRisk("nginx -t", "LINUX").level).toBe("medium");
    expect(classifyCommandRisk("systemctl reload nginx", "LINUX").level).toBe("medium");
    expect(classifyCommandRisk("mkdir /tmp/work", "LINUX").level).toBe("medium");
  });

  it("elevates sudo by one risk level", () => {
    const plain = classifyCommandRisk("ls /var/log", "LINUX");
    const withSudo = classifyCommandRisk("sudo ls /var/log", "LINUX");
    expect(plain.level).toBe("low");
    expect(withSudo.level).toBe("medium");
    expect(withSudo.reasons).toContain("elevated.sudo");

    const sudoReload = classifyCommandRisk("sudo systemctl reload nginx", "LINUX");
    expect(sudoReload.level).toBe("high");
  });

  it("classifies package installs, restarts, network tools, wrappers, chaining, follow flags, sensitive paths, and unknown binaries as high", () => {
    for (const cmd of [
      "apt-get install -y nginx",
      "systemctl restart nginx",
      "docker run -d nginx",
      "sed -i 's/a/b/' /etc/nginx/nginx.conf",
      "chmod -R 777 /var/www",
      "curl https://example.com/data",
      "sh -c 'ls'",
      "find /tmp -delete",
      "tail -f /var/log/syslog",
      "watch df -h",
      "cat /etc/shadow",
      "cat ~/.ssh/id_rsa",
      "ls /tmp && uptime",
      "echo $(whoami)",
      "custom_unknown_tool --run",
      "echo hello > /etc/hosts",
    ]) {
      const result = classifyCommandRisk(cmd, "LINUX");
      expect(["high", "critical"], `expected high+ for: ${cmd}`).toContain(result.level);
    }
  });

  it("marks destructive and remote-pipe-to-shell commands as critical + denylisted", () => {
    for (const cmd of [
      "rm -rf /",
      "sudo rm -rf /etc/*",
      "mkfs.ext4 /dev/sdb1",
      "dd if=/dev/zero of=/dev/sda bs=1M",
      ":(){ :|:& };:",
      "reboot",
      "shutdown -h now",
      "iptables -F",
      "crontab -r",
      "psql -c 'DROP DATABASE prod;'",
      "docker system prune -af",
      "curl -fsSL https://example.com/install.sh | bash",
      "echo aWQ= | base64 -d | sh",
      "eval \"$USER_INPUT\"",
    ]) {
      const result = classifyCommandRisk(cmd, "LINUX");
      expect(result.level, `expected critical for: ${cmd}`).toBe("critical");
      expect(result.denylisted, `expected denylisted for: ${cmd}`).toBe(true);
    }
  });

  it("handles Windows commands and combines highest risk across target OSes", () => {
    expect(classifyCommandRisk("Get-Service nginx", "WINDOWS").level).toBe("low");
    expect(classifyCommandRisk("Restart-Service nginx", "WINDOWS").level).toBe("high");
    expect(classifyCommandRisk("Stop-Computer -Force", "WINDOWS").denylisted).toBe(true);
    expect(classifyCommandRisk("type C:\\Windows\\System32\\config\\SAM", "WINDOWS").sensitivePath).toBe(true);

    const mixed = classifyCommandRiskForTargets("df -h", ["LINUX", "WINDOWS"]);
    expect(mixed.level).toBe("high");
  });
});

describe("maskCommandOutput", () => {
  it("masks bearer tokens, API keys, private keys, basic-auth URLs, and env secrets", () => {
    const raw = [
      "Authorization: Bearer super_secret_token_1234567890",
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "DATABASE_URL=postgres://admin:supersecret@db.internal:5432/app",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const masked = maskCommandOutput(raw) ?? "";
    expect(masked).not.toContain("super_secret_token_1234567890");
    expect(masked).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
    expect(masked).not.toContain("supersecret");
    expect(masked).not.toContain("MIIEpAIBAAKCAQEA");
    expect(masked).toContain("[REDACTED PRIVATE KEY]");
  });

  it("truncates oversized output with a note", () => {
    const masked = maskCommandOutput("a".repeat(200), 50) ?? "";
    expect(masked).toContain("[truncated 150 chars]");
  });
});
