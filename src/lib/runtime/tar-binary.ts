import { existsSync } from "node:fs";
import path from "node:path";

function system32TarPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "tar.exe");
}

/**
 * Resolve the tar binary used for local (hub-host) archive operations.
 *
 * Windows ships bsdtar as System32\tar.exe, but a GNU tar from Git Bash,
 * MSYS or GnuWin can shadow it in PATH. GNU tar interprets "C:\..." path
 * arguments as remote-host specs ("Cannot connect to C"), breaking every
 * local archive operation. On win32 prefer the OS-bundled System32 bsdtar
 * explicitly; other platforms keep plain PATH lookup.
 */
export function resolveLocalTarBinary(): string {
  if (process.platform !== "win32") return "tar";
  const system32Tar = system32TarPath();
  return existsSync(system32Tar) ? system32Tar : "tar";
}

/**
 * Extra argv that stops the resolved tar from parsing `host:path`-looking
 * arguments as remote-tape specs.
 *
 * GNU tar (Debian/Ubuntu images, PATH-shadowing installs on Windows) treats
 * `name:with:colon` members — including entries inside a `-T` file list whose
 * names come from user-uploaded filenames — as `rsh`-style remote specs and
 * attempts an outbound connection. `--force-local` disables that parsing.
 * bsdtar (System32 tar on Windows) has no remote-tape parsing at all and
 * rejects the unknown flag, so it gets an empty argv tail instead.
 */
export function localTarForceLocalArgs(): string[] {
  if (process.platform === "win32" && existsSync(system32TarPath())) {
    return [];
  }
  return ["--force-local"];
}
