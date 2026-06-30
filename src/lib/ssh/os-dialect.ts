/**
 * OS Dialect Abstraction Layer (TR-041)
 *
 * VControlHub 纳管的 VPS 节点可能运行不同的 Linux 发行版。
 * 原始代码假设所有 VPS 都是 Debian/Ubuntu 系（apt + systemd），
 * 本模块提供 OS 方言抽象，让上层代码通过统一接口操作不同发行版。
 *
 * 核心抽象：
 * - packageManager:  apt | dnf | yum | apk | pacman | zypper
 * - serviceManager:   systemd | openrc | sysvinit
 * - 已预设 6 大主流发行版族的方言配置
 *
 * 探测流程：SSH exec `cat /etc/os-release` → parse → 匹配预设 → 缓存到 Server.osDialect
 */

import type { SshConnectionParams } from "./client";
import { execRemoteCommand } from "./client";

/* ── Types ────────────────────────────────────────────────── */

/** 包管理器类型 */
export type PackageManager = "apt" | "dnf" | "yum" | "apk" | "pacman" | "zypper";

/** 服务管理器类型 */
export type ServiceManager = "systemd" | "openrc" | "sysvinit";

/** OS 方言配置 — 描述某个 VPS 的 OS 特征 */
export interface OsDialect {
  /** 包管理器 */
  packageManager: PackageManager;
  /** 服务管理器 */
  serviceManager: ServiceManager;
  /** 发行版名称，如 "Ubuntu 22.04 LTS" */
  distroName: string;
  /** 发行版族，如 "debian", "rhel", "alpine", "arch", "suse" */
  distroFamily: string;
  /** 默认 shell */
  defaultShell: string;
  /** sudo 模式 — 是否需要 -n 标志（non-interactive） */
  sudoPattern: string;
  /** 常见配置文件路径 */
  configPaths: {
    nginx: string;
    sshd: string;
    fail2ban: string;
    docker: string;
  };
  /** 探测时间戳 (ISO string)，null 表示未探测 */
  detectedAt: string | null;
}

/** /etc/os-release 解析结果 */
export interface OsReleaseInfo {
  id: string;
  idLike: string;
  name: string;
  version: string;
  versionCodename: string;
  prettyName: string;
}

/* ── Presets ──────────────────────────────────────────────── */

/** Debian/Ubuntu 系预设 */
const DEBIAN_PRESET: Omit<OsDialect, "distroName" | "detectedAt"> = {
  packageManager: "apt",
  serviceManager: "systemd",
  distroFamily: "debian",
  defaultShell: "/bin/bash",
  sudoPattern: "sudo -n",
  configPaths: {
    nginx: "/etc/nginx/nginx.conf",
    sshd: "/etc/ssh/sshd_config",
    fail2ban: "/etc/fail2ban/jail.local",
    docker: "/etc/docker/daemon.json",
  },
};

/** RHEL/CentOS/Rocky/Alma/Fedora 系预设 */
const RHEL_PRESET: Omit<OsDialect, "distroName" | "detectedAt"> = {
  packageManager: "dnf",
  serviceManager: "systemd",
  distroFamily: "rhel",
  defaultShell: "/bin/bash",
  sudoPattern: "sudo -n",
  configPaths: {
    nginx: "/etc/nginx/nginx.conf",
    sshd: "/etc/ssh/sshd_config",
    fail2ban: "/etc/fail2ban/jail.local",
    docker: "/etc/docker/daemon.json",
  },
};

/** Alpine Linux 预设 */
const ALPINE_PRESET: Omit<OsDialect, "distroName" | "detectedAt"> = {
  packageManager: "apk",
  serviceManager: "openrc",
  distroFamily: "alpine",
  defaultShell: "/bin/ash",
  sudoPattern: "sudo -n",
  configPaths: {
    nginx: "/etc/nginx/nginx.conf",
    sshd: "/etc/ssh/sshd_config",
    fail2ban: "/etc/fail2ban/jail.local",
    docker: "/etc/docker/daemon.json",
  },
};

/** Arch Linux 预设 */
const ARCH_PRESET: Omit<OsDialect, "distroName" | "detectedAt"> = {
  packageManager: "pacman",
  serviceManager: "systemd",
  distroFamily: "arch",
  defaultShell: "/bin/bash",
  sudoPattern: "sudo -n",
  configPaths: {
    nginx: "/etc/nginx/nginx.conf",
    sshd: "/etc/ssh/sshd_config",
    fail2ban: "/etc/fail2ban/jail.local",
    docker: "/etc/docker/daemon.json",
  },
};

/** openSUSE/SLES 预设 */
const SUSE_PRESET: Omit<OsDialect, "distroName" | "detectedAt"> = {
  packageManager: "zypper",
  serviceManager: "systemd",
  distroFamily: "suse",
  defaultShell: "/bin/bash",
  sudoPattern: "sudo -n",
  configPaths: {
    nginx: "/etc/nginx/nginx.conf",
    sshd: "/etc/ssh/sshd_config",
    fail2ban: "/etc/fail2ban/jail.local",
    docker: "/etc/docker/daemon.json",
  },
};

/** 默认方言（Debian/Ubuntu，向后兼容） */
export const DEFAULT_DIALECT: OsDialect = {
  ...DEBIAN_PRESET,
  distroName: "Unknown (default: Debian)",
  detectedAt: null,
};

/* ── Parsing ──────────────────────────────────────────────── */

/**
 * 解析 /etc/os-release 文本内容为结构化信息。
 *
 * /etc/os-release 格式示例：
 *   NAME="Ubuntu"
 *   VERSION="22.04 LTS"
 *   ID=ubuntu
 *   ID_LIKE=debian
 *   PRETTY_NAME="Ubuntu 22.04 LTS"
 */
export function parseOsRelease(raw: string): OsReleaseInfo {
  const lines = raw.split("\n");
  const kv: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.+))$/);
    if (match && match[1]) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? "";
      kv[key] = value;
    }
  }

  return {
    id: (kv.ID ?? "").toLowerCase(),
    idLike: (kv.ID_LIKE ?? "").toLowerCase(),
    name: kv.NAME ?? "",
    version: kv.VERSION ?? "",
    versionCodename: kv.VERSION_CODENAME ?? "",
    prettyName: kv.PRETTY_NAME ?? "",
  };
}

/**
 * 根据 /etc/os-release 解析结果匹配方言预设。
 *
 * 匹配逻辑：先看 ID，再看 ID_LIKE，最后 fallback 到 Debian 默认。
 */
export function dialectFromOsRelease(info: OsReleaseInfo): OsDialect {
  const id = info.id;
  const idLike = info.idLike;

  // 直接匹配
  if (id === "ubuntu" || id === "debian" || id === "linuxmint" || id === "raspbian") {
    return { ...DEBIAN_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (id === "rhel" || id === "centos" || id === "rocky" || id === "almalinux" || id === "fedora" || id === "ol" || id === "amzn") {
    // Amazon Linux 2 uses yum, newer uses dnf
    const pm: PackageManager = id === "amzn" && info.version.startsWith("2") ? "yum" : "dnf";
    return { ...RHEL_PRESET, packageManager: pm, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (id === "alpine") {
    return { ...ALPINE_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (id === "arch" || id === "manjaro" || id === "endeavouros" || id === "garuda") {
    return { ...ARCH_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (id === "opensuse" || id === "opensuse-leap" || id === "opensuse-tumbleweed" || id === "sles" || id === "suse") {
    return { ...SUSE_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }

  // ID_LIKE 匹配 (debian-like, rhel-fedora-like 等)
  if (idLike.includes("debian") || idLike.includes("ubuntu")) {
    return { ...DEBIAN_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (idLike.includes("rhel") || idLike.includes("fedora") || idLike.includes("centos")) {
    return { ...RHEL_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (idLike.includes("suse")) {
    return { ...SUSE_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }
  if (idLike.includes("arch")) {
    return { ...ARCH_PRESET, distroName: info.prettyName || info.name, detectedAt: null };
  }

  // Fallback: Debian 默认（向后兼容）
  return { ...DEBIAN_PRESET, distroName: info.prettyName || info.name || "Unknown", detectedAt: null };
}

/* ── Detection ────────────────────────────────────────────── */

/**
 * 通过 SSH 连接到远端 VPS 并探测其 OS 方言。
 *
 * 探测命令：`cat /etc/os-release 2>/dev/null || uname -a`
 * 如果 /etc/os-release 不存在（极老系统），fallback 到 uname。
 *
 * @returns 探测到的 OsDialect，失败时返回 DEFAULT_DIALECT
 */
export async function detectOsDialect(sshParams: SshConnectionParams): Promise<OsDialect> {
  try {
    const { stdout, exitCode } = await execRemoteCommand({
      ...sshParams,
      command: "cat /etc/os-release 2>/dev/null",
      timeout: 10_000,
    });

    if (exitCode === 0 && stdout.trim()) {
      const info = parseOsRelease(stdout);
      const dialect = dialectFromOsRelease(info);
      return { ...dialect, detectedAt: new Date().toISOString() };
    }

    // Fallback: 极老系统没有 /etc/os-release，用 uname 粗猜
    const { stdout: unameOut } = await execRemoteCommand({
      ...sshParams,
      command: "uname -a",
      timeout: 10_000,
    });

    if (unameOut.toLowerCase().includes("alpine")) {
      return { ...ALPINE_PRESET, distroName: "Alpine (uname fallback)", detectedAt: new Date().toISOString() };
    }
    if (unameOut.toLowerCase().includes("centos") || unameOut.toLowerCase().includes("rhel")) {
      return { ...RHEL_PRESET, distroName: "RHEL/CentOS (uname fallback)", detectedAt: new Date().toISOString() };
    }

    return { ...DEFAULT_DIALECT, distroName: "Unknown (uname fallback)", detectedAt: new Date().toISOString() };
  } catch {
    return { ...DEFAULT_DIALECT, detectedAt: new Date().toISOString() };
  }
}

/* ── Command Builders ─────────────────────────────────────── */

/**
 * 生成服务管理器命令。
 *
 * @param manager  服务管理器类型
 * @param action   操作类型: status | reload | restart | start | stop | enable | disable
 * @param unit     服务单元名（已过 sanitize）
 * @param sudoPattern sudo 前缀，如 "sudo -n"
 * @returns 完整的 shell 命令字符串
 */
export function serviceCommand(
  manager: ServiceManager,
  action: "status" | "reload" | "restart" | "start" | "stop" | "enable" | "disable",
  unit: string,
  sudoPattern = "sudo -n",
): string {
  switch (manager) {
    case "systemd":
      if (action === "status") return `systemctl status ${unit} --no-pager -l`;
      if (action === "reload") return `${sudoPattern} systemctl reload ${unit} || ${sudoPattern} systemctl restart ${unit}`;
      return `${sudoPattern} systemctl ${action} ${unit}`;

    case "openrc":
      // OpenRC: rc-service <service> <action>; enable/disable uses rc-update
      if (action === "enable") return `${sudoPattern} rc-update add ${unit} default`;
      if (action === "disable") return `${sudoPattern} rc-update del ${unit} default`;
      if (action === "status") return `rc-service ${unit} status`;
      return `${sudoPattern} rc-service ${unit} ${action}`;

    case "sysvinit":
      // SysVinit: service <name> <action>; enable/disable uses update-rc.d or chkconfig
      if (action === "enable") return `${sudoPattern} update-rc.d ${unit} enable`;
      if (action === "disable") return `${sudoPattern} update-rc.d ${unit} disable`;
      if (action === "status") return `service ${unit} status`;
      return `${sudoPattern} service ${unit} ${action}`;
  }
}

/**
 * 生成包管理器命令。
 *
 * @param manager  包管理器类型
 * @param action   操作类型: install | update | upgrade | remove | search
 * @param packages 包名列表（已过 sanitize）
 * @param sudoPattern sudo 前缀
 * @returns 完整的 shell 命令字符串
 */
export function packageCommand(
  manager: PackageManager,
  action: "install" | "update" | "upgrade" | "remove" | "search",
  packages: string[] = [],
  sudoPattern = "sudo -n",
): string {
  const pkgs = packages.join(" ");

  switch (manager) {
    case "apt":
      if (action === "update") return `${sudoPattern} apt-get update`;
      if (action === "upgrade") return `${sudoPattern} apt-get update && ${sudoPattern} apt-get upgrade -y`;
      if (action === "install") return `${sudoPattern} apt-get install -y ${pkgs}`;
      if (action === "remove") return `${sudoPattern} apt-get remove -y ${pkgs}`;
      if (action === "search") return `apt-cache search ${pkgs}`;
      break;

    case "dnf":
      if (action === "update") return `${sudoPattern} dnf check-update`;
      if (action === "upgrade") return `${sudoPattern} dnf upgrade -y`;
      if (action === "install") return `${sudoPattern} dnf install -y ${pkgs}`;
      if (action === "remove") return `${sudoPattern} dnf remove -y ${pkgs}`;
      if (action === "search") return `dnf search ${pkgs}`;
      break;

    case "yum":
      if (action === "update") return `${sudoPattern} yum check-update`;
      if (action === "upgrade") return `${sudoPattern} yum update -y`;
      if (action === "install") return `${sudoPattern} yum install -y ${pkgs}`;
      if (action === "remove") return `${sudoPattern} yum remove -y ${pkgs}`;
      if (action === "search") return `yum search ${pkgs}`;
      break;

    case "apk":
      if (action === "update") return `${sudoPattern} apk update`;
      if (action === "upgrade") return `${sudoPattern} apk upgrade`;
      if (action === "install") return `${sudoPattern} apk add ${pkgs}`;
      if (action === "remove") return `${sudoPattern} apk del ${pkgs}`;
      if (action === "search") return `apk search ${pkgs}`;
      break;

    case "pacman":
      if (action === "update") return `${sudoPattern} pacman -Sy`;
      if (action === "upgrade") return `${sudoPattern} pacman -Syu --noconfirm`;
      if (action === "install") return `${sudoPattern} pacman -S --noconfirm ${pkgs}`;
      if (action === "remove") return `${sudoPattern} pacman -R --noconfirm ${pkgs}`;
      if (action === "search") return `pacman -Ss ${pkgs}`;
      break;

    case "zypper":
      if (action === "update") return `${sudoPattern} zypper refresh`;
      if (action === "upgrade") return `${sudoPattern} zypper update -y`;
      if (action === "install") return `${sudoPattern} zypper install -y ${pkgs}`;
      if (action === "remove") return `${sudoPattern} zypper remove -y ${pkgs}`;
      if (action === "search") return `zypper search ${pkgs}`;
      break;
  }
  return "";
}

/**
 * 从 Server 记录上的 JSON 字段反序列化 OsDialect。
 * 如果字段为空或解析失败，返回 DEFAULT_DIALECT。
 */
export function deserializeDialect(json: string | null | undefined): OsDialect {
  if (!json) return DEFAULT_DIALECT;
  try {
    const parsed = JSON.parse(json) as Partial<OsDialect>;
    if (!parsed.packageManager || !parsed.serviceManager) return DEFAULT_DIALECT;
    return { ...DEFAULT_DIALECT, ...parsed };
  } catch {
    return DEFAULT_DIALECT;
  }
}

/**
 * 序列化 OsDialect 为 JSON 字符串，用于存储到 Prisma。
 */
export function serializeDialect(dialect: OsDialect): string {
  return JSON.stringify(dialect);
}
