/**
 * Deterministic server-side command risk classifier.
 *
 * Used by POST /api/commands, POST /api/commands/preview, AI hosted actions
 * (AUTO / FULL_AUTO / inline confirm), and deployment approval evaluation.
 *
 * Design principles:
 * - Pure, synchronous, zero I/O.
 * - Can only elevate risk; anything unparseable or unrecognized is classified
 *   at least "high" (never silently "low").
 * - `denylisted: true` marks catastrophic / destructive / remote-code-pipe
 *   commands that NEVER auto-execute even under FULL_AUTO.
 * - Remember: pattern classification is a change-control guardrail, NOT a
 *   security boundary (RBAC + tenant scope + live execution authz remain the
 *   authoritative boundary).
 */
import { commandMentionsSensitivePath } from "./sensitive-paths";

export type CommandRiskLevel = "low" | "medium" | "high" | "critical";

export const COMMAND_RISK_CLASSIFIER_VERSION = "r19.v1";

const RISK_RANK: Record<CommandRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function maxRiskLevel(...levels: Array<CommandRiskLevel | null | undefined>): CommandRiskLevel {
  let highest: CommandRiskLevel = "low";
  for (const level of levels) {
    if (level && RISK_RANK[level] > RISK_RANK[highest]) {
      highest = level;
    }
  }
  return highest;
}

export function isHighOrCriticalRisk(level: CommandRiskLevel): boolean {
  return RISK_RANK[level] >= RISK_RANK.high;
}

export interface CommandRiskAssessment {
  level: CommandRiskLevel;
  reasons: string[];
  denylisted: boolean;
  sensitivePath: boolean;
  version: string;
}

type PatternRule = {
  pattern: RegExp;
  reason: string;
};

const CRITICAL_DENYLIST_RULES: PatternRule[] = [
  // rm -rf / or /* or system directories or ~
  {
    pattern:
      /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?rm\s+(?:[^;&|\n]*\s)?-(?:[a-zA-Z]*[rf][a-zA-Z]*\s+)*[a-zA-Z]*[rf][a-zA-Z]*(?:\s+--no-preserve-root)?\s+(?:\/(?:\s|$|\*|[;&|])|\/(?:etc|usr|var|bin|sbin|lib|lib64|boot|root|home|opt|srv|sys|proc|dev)(?:\/?\*|\s|$|[;&|])|~(?:\/?\*|\s|$|[;&|]))/i,
    reason: "critical.destructive_rm_root",
  },
  // Disk/partition destruction tools
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?(?:mkfs(?:\.[a-z0-9]+)?|wipefs|shred|fdisk|sfdisk|parted|gdisk|blkdiscard)\b/i,
    reason: "critical.disk_format_or_wipe",
  },
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?dd\b[^;&|\n]*\bof=\/dev\//i,
    reason: "critical.dd_raw_device",
  },
  // Fork bomb
  {
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    reason: "critical.fork_bomb",
  },
  // Host power / reboot / halt
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?(?:shutdown|reboot|halt|poweroff|init\s+[06]|telinit\s+[06]|systemctl\s+(?:reboot|poweroff|halt|kexec))\b/i,
    reason: "critical.host_power_control",
  },
  // Firewall flush / reset
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?(?:iptables(?:-restore)?\s+[^;&|\n]*(?:-F|--flush|-X)|ufw\s+(?:reset|disable)|nft\s+flush\s+ruleset)\b/i,
    reason: "critical.firewall_flush",
  },
  // Crontab wipe
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?crontab\s+[^;&|\n]*-r\b/i,
    reason: "critical.crontab_remove",
  },
  // Destructive SQL
  {
    pattern: /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i,
    reason: "critical.destructive_sql",
  },
  // Docker prune / volume removal
  {
    pattern: /\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune))\b/i,
    reason: "critical.docker_prune_or_volume_rm",
  },
  // Remote code piped to shell or eval
  {
    pattern: /\b(?:curl|wget|fetch)\b[^|\n]*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:ba|da|z|k|a)?sh\b/i,
    reason: "critical.remote_pipe_to_shell",
  },
  {
    pattern: /\bbase64\s+(?:-d|--decode)\b[^|\n]*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:ba|da|z|k|a)?sh\b/i,
    reason: "critical.encoded_pipe_to_shell",
  },
  {
    pattern: /(?:^|[;&|(\s])eval\s+/i,
    reason: "critical.shell_eval",
  },
  // Windows destructive commands
  {
    pattern: /\b(?:format\s+[a-z]:|diskpart|bcdedit|Remove-Item\s+[^;&|\n]*-Recurse\s+[^;&|\n]*[a-z]:\\(?:\s|$|\*)|rd\s+\/s\s+\/q\s+[a-z]:\\(?:\s|$)|Stop-Computer|Restart-Computer|shutdown\s+\/[rs])\b/i,
    reason: "critical.windows_destructive",
  },
];

const HIGH_RISK_RULES: PatternRule[] = [
  // Package managers
  {
    pattern: /\b(?:apt(?:-get)?|yum|dnf|apk|zypper|pacman|brew|pip3?|npm|pnpm|yarn|gem|cargo|choco|winget)\s+(?:install|remove|purge|uninstall|upgrade|dist-upgrade|autoremove|add|del)\b/i,
    reason: "high.package_management",
  },
  // Service mutations
  {
    pattern: /\b(?:systemctl|service|rc-service|supervisorctl)\s+(?:restart|stop|start|disable|enable|mask|kill)\b/i,
    reason: "high.service_mutation",
  },
  // Docker mutations
  {
    pattern: /\bdocker(?:\s+compose|-compose)?\s+(?:run|rm|stop|kill|restart|exec|up|down|build|push|pull|network\s+rm|image\s+rm|rmi)\b/i,
    reason: "high.docker_mutation",
  },
  // Config/file mutation under /etc or in-place edits
  {
    pattern: /(?:^|[;&|(\s])(?:tee|sed\s+[^;&|\n]*-i|perl\s+[^;&|\n]*-i)\b/i,
    reason: "high.file_write_utility",
  },
  {
    pattern: /(?:^|[;&|(\s])(?:cp|mv|ln|install)\b[^;&|\n]*\/etc\//i,
    reason: "high.etc_modification",
  },
  // Recursive permission/ownership changes
  {
    pattern: /\b(?:chmod|chown|chgrp)\s+[^;&|\n]*(?:-[a-zA-Z]*R|--recursive)\b/i,
    reason: "high.recursive_permission_change",
  },
  // Process termination / kernel / mounts / file deletion
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?(?:kill|killall|pkill|rm|rmdir|unlink|mount|umount|sysctl\s+-w|useradd|userdel|usermod|passwd|visudo)\b/i,
    reason: "high.system_or_file_mutation",
  },
  // Network transfer / exfiltration tools
  {
    pattern: /(?:^|[;&|(\s])(?:sudo\s+(?:-\S+\s+)*)?(?:curl|wget|nc|ncat|netcat|socat|scp|sftp|rsync|ssh|ftp|telnet)\b/i,
    reason: "high.network_tool",
  },
  // Shell wrappers / arbitrary code execution
  {
    pattern: /\b(?:(?:ba|da|z|k|a)?sh\s+-[a-zA-Z]*c|env\s+\S|xargs\b|find\b[^;&|\n]*(?:-exec|-execdir|-delete)\b|awk\b[^;&|\n]*system\s*\(|(?:python3?|node|ruby|perl|php)\s+-(?:c|e|r)\b)/i,
    reason: "high.shell_or_interpreter_wrapper",
  },
  // Interactive / streaming / infinite follow commands (must never auto-run)
  {
    pattern: /\b(?:tail\s+[^;&|\n]*(?:-[a-zA-Z]*f|--follow)|journalctl\s+[^;&|\n]*(?:-[a-zA-Z]*f|--follow)|docker\s+logs\s+[^;&|\n]*(?:-[a-zA-Z]*f|--follow)|watch\b|top\b(?!\s+[^;&|\n]*-b[^;&|\n]*-n\s*1)|htop\b|vim?\b|nano\b|less\b|more\b)/i,
    reason: "high.interactive_or_follow",
  },
];

const SAFE_READ_ONLY_BINARIES = new Set([
  "ls",
  "ll",
  "la",
  "cat",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "df",
  "du",
  "free",
  "uptime",
  "uname",
  "hostname",
  "whoami",
  "id",
  "date",
  "pwd",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "stat",
  "file",
  "which",
  "whereis",
  "ps",
  "pgrep",
  "ss",
  "netstat",
  "ip",
  "ifconfig",
  "route",
  "lscpu",
  "lsblk",
  "lsusb",
  "lspci",
  "lsof",
  "dmesg",
  "journalctl",
  "last",
  "who",
  "w",
  "vmstat",
  "iostat",
  "mpstat",
  "sar",
  "printenv",
  "true",
  "echo",
  "printf",
]);

const MEDIUM_UTILITY_BINARIES = new Set([
  "mkdir",
  "touch",
  "cp",
  "mv",
  "tar",
  "gzip",
  "gunzip",
  "zip",
  "unzip",
  "git",
  "nginx",
  "caddy",
  "haproxy",
  "apachectl",
  "apache2ctl",
  "mysqladmin",
  "pg_isready",
  "redis-cli",
  "timedatectl",
  "hostnamectl",
  "localectl",
  "logrotate",
  "certbot",
]);

const WINDOWS_SAFE_READ_ONLY_PATTERNS = [
  /^(?:powershell(?:\.exe)?\s+(?:-\S+\s+)*)?(?:Get-(?:Service|Process|ChildItem|Content|Date|ComputerInfo|Volume|Disk|NetIPAddress|NetTCPConnection|EventLog|WinEvent|CimInstance|WmiObject)|hostname|whoami|ipconfig|systeminfo|tasklist|ver|dir|type)\b/i,
];

/** Remove benign stderr-to-/dev/null redirections before checking for output redirections. */
function stripBenignNullRedirects(command: string): string {
  return command.replace(/\b2\s*>\s*\/dev\/null\b/g, " ").replace(/\b2\s*>&\s*1\b/g, " ");
}

function hasWriteRedirection(command: string): boolean {
  const stripped = stripBenignNullRedirects(command);
  return /(?:^|[^0-9])(?:>>?|<<|<>\s*|&>>?)\s*\S/.test(stripped);
}

function hasCommandSubstitutionOrChain(command: string): boolean {
  return /\$\(|`|;|&&|\|\||\n/.test(command);
}

/** Classify a single pipeline segment (e.g. `docker ps -a` or `systemctl status nginx`). */
function classifySingleSegment(segment: string): { level: CommandRiskLevel; reason: string; usedSudo: boolean } {
  const trimmed = segment.trim();
  if (!trimmed) return { level: "high", reason: "high.empty_or_unparseable", usedSudo: false };

  let usedSudo = false;
  let rest = trimmed;
  const sudoMatch = rest.match(/^sudo\s+(?:-[a-zA-Z]+\s+)*(?:-u\s+\S+\s+)?(.*)$/);
  if (sudoMatch) {
    usedSudo = true;
    rest = sudoMatch[1]!.trim();
  }
  if (!rest) return { level: "high", reason: "high.sudo_empty", usedSudo: true };

  // Strip leading VAR=val env assignments
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(rest)) {
    rest = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, "").trim();
  }

  const parts = rest.split(/\s+/);
  const bin = (parts[0] ?? "").replace(/^.*\//, "");
  const sub = parts[1] ?? "";

  if (!bin || !/^[A-Za-z0-9._-]+$/.test(bin)) {
    return { level: "high", reason: "high.unrecognized_command", usedSudo };
  }

  // Read-only subcommands of systemctl / docker / git / nginx / caddy
  if (bin === "systemctl" && ["status", "is-active", "is-enabled", "is-failed", "list-units", "list-unit-files", "list-timers", "show", "cat"].includes(sub)) {
    return { level: "low", reason: "low.readonly_service_inspect", usedSudo };
  }
  if (bin === "systemctl" && sub === "reload") {
    return { level: "medium", reason: "medium.service_reload", usedSudo };
  }
  if (bin === "docker" && ["ps", "images", "logs", "inspect", "version", "info", "stats", "top", "port", "network", "volume"].includes(sub)) {
    const sub2 = parts[2] ?? "";
    if ((sub === "network" || sub === "volume") && !["ls", "inspect"].includes(sub2)) {
      return { level: "high", reason: "high.docker_mutation", usedSudo };
    }
    return { level: "low", reason: "low.readonly_docker_inspect", usedSudo };
  }
  if (bin === "git" && ["status", "log", "diff", "branch", "rev-parse", "show", "tag"].includes(sub)) {
    return { level: "low", reason: "low.readonly_git_inspect", usedSudo };
  }
  if ((bin === "nginx" || bin === "caddy" || bin === "haproxy") && (parts.includes("-t") || sub === "validate" || parts.includes("-c"))) {
    return { level: "medium", reason: "medium.config_validate", usedSudo };
  }
  if (bin === "top" && parts.includes("-b") && parts.some((p) => p === "-n1" || p === "-n")) {
    return { level: "low", reason: "low.readonly_inspect", usedSudo };
  }
  if (bin === "find" && !/\s-(?:exec|execdir|ok|okdir|delete|fls|fprint)\b/.test(rest)) {
    return { level: "low", reason: "low.readonly_find", usedSudo };
  }
  if (SAFE_READ_ONLY_BINARIES.has(bin)) {
    return { level: "low", reason: "low.readonly_inspect", usedSudo };
  }
  if (MEDIUM_UTILITY_BINARIES.has(bin)) {
    return { level: "medium", reason: "medium.standard_utility", usedSudo };
  }

  return { level: "high", reason: "high.unknown_binary", usedSudo };
}

function elevateOneLevel(level: CommandRiskLevel): CommandRiskLevel {
  if (level === "low") return "medium";
  if (level === "medium") return "high";
  return level;
}

export function classifyCommandRisk(
  rawCommand: string,
  operatingSystem: string = "LINUX",
): CommandRiskAssessment {
  const command = rawCommand.trim();
  const reasons = new Set<string>();
  let denylisted = false;
  let level: CommandRiskLevel = "low";

  if (!command) {
    return {
      level: "high",
      reasons: ["high.empty_command"],
      denylisted: false,
      sensitivePath: false,
      version: COMMAND_RISK_CLASSIFIER_VERSION,
    };
  }

  // 1. Critical denylist (always checked first, across all OSes)
  for (const rule of CRITICAL_DENYLIST_RULES) {
    if (rule.pattern.test(command)) {
      denylisted = true;
      level = "critical";
      reasons.add(rule.reason);
    }
  }

  // 2. Sensitive path references (strip benign 2>/dev/null and 2>&1 first)
  const sensitivePath = commandMentionsSensitivePath(stripBenignNullRedirects(command));
  if (sensitivePath) {
    level = maxRiskLevel(level, "high");
    reasons.add("high.sensitive_path");
  }

  // 3. Windows classification
  if (operatingSystem.toUpperCase() === "WINDOWS") {
    const isSafeWinRead =
      !hasCommandSubstitutionOrChain(command) &&
      !hasWriteRedirection(command) &&
      WINDOWS_SAFE_READ_ONLY_PATTERNS.some((re) => re.test(command));
    if (isSafeWinRead) {
      reasons.add("low.windows_readonly");
    } else {
      level = maxRiskLevel(level, "high");
      reasons.add("high.windows_non_readonly");
    }
    return {
      level,
      reasons: [...reasons],
      denylisted,
      sensitivePath,
      version: COMMAND_RISK_CLASSIFIER_VERSION,
    };
  }

  // 4. High-risk pattern rules
  for (const rule of HIGH_RISK_RULES) {
    if (rule.pattern.test(command)) {
      level = maxRiskLevel(level, "high");
      reasons.add(rule.reason);
    }
  }

  // 5. Write redirections & heredocs (ignoring benign 2>/dev/null and 2>&1)
  if (hasWriteRedirection(command)) {
    level = maxRiskLevel(level, "high");
    reasons.add("high.write_redirection");
  }

  // 6. Command chaining / substitutions / multi-line scripts
  if (hasCommandSubstitutionOrChain(command)) {
    level = maxRiskLevel(level, "high");
    reasons.add("high.command_chaining");
  }

  // 7. Pipeline inspection: pipes between read-only commands stay low; unknown binaries or sudo elevate
  const normalizedForPipe = stripBenignNullRedirects(command);
  const pipeSegments = normalizedForPipe.split(/(?<!\|)\|(?!\|)/);
  let anySudo = false;
  for (const seg of pipeSegments) {
    const segResult = classifySingleSegment(seg);
    level = maxRiskLevel(level, segResult.level);
    if (segResult.level !== "low" || reasons.size === 0) {
      reasons.add(segResult.reason);
    }
    if (segResult.usedSudo) anySudo = true;
  }

  if (anySudo) {
    level = maxRiskLevel(level, elevateOneLevel(level));
    reasons.add("elevated.sudo");
  }

  if (reasons.size === 0) {
    reasons.add("low.readonly_inspect");
  }

  return {
    level,
    reasons: [...reasons],
    denylisted,
    sensitivePath,
    version: COMMAND_RISK_CLASSIFIER_VERSION,
  };
}

/**
 * Evaluate a command across multiple target operating systems and return the
 * highest-risk combined assessment.
 */
export function classifyCommandRiskForTargets(
  command: string,
  operatingSystems: readonly (string | null | undefined)[],
): CommandRiskAssessment {
  const uniqueOs = Array.from(
    new Set(
      operatingSystems.length > 0
        ? operatingSystems.map((os) => (os?.trim() ? os.trim().toUpperCase() : "LINUX"))
        : ["LINUX"],
    ),
  );
  let combined: CommandRiskAssessment | null = null;
  for (const os of uniqueOs) {
    const current = classifyCommandRisk(command, os);
    if (!combined) {
      combined = current;
      continue;
    }
    combined = {
      level: maxRiskLevel(combined.level, current.level),
      reasons: Array.from(new Set([...combined.reasons, ...current.reasons])),
      denylisted: combined.denylisted || current.denylisted,
      sensitivePath: combined.sensitivePath || current.sensitivePath,
      version: COMMAND_RISK_CLASSIFIER_VERSION,
    };
  }
  return combined ?? classifyCommandRisk(command, "LINUX");
}
