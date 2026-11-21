import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { expandStorageBasePath, resolveStoragePathWithinBase } from "./path-utils";

// The child's standard input is a duplicate of the already-open file handle.
const windowsHandlePath = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FilePath {
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetFinalPathNameByHandle(IntPtr h, StringBuilder s, uint n, uint flags);
}
'@
$s=New-Object Text.StringBuilder 32768
$n=[FilePath]::GetFinalPathNameByHandle([FilePath]::GetStdHandle(-10),$s,32768,0)
if ($n -eq 0 -or $n -ge 32768) { exit 1 }
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::Write($s.ToString())`;

async function openedPath(fd: number): Promise<string> {
  if (process.platform === "linux") return readlink("/proc/self/fd/" + fd);
  const windows = process.platform === "win32";
  const child = spawn(windows ? "powershell.exe" : "python3", windows
    ? ["-NoProfile", "-NonInteractive", "-Command", windowsHandlePath]
    : ["-c", "import fcntl,os; os.write(1,fcntl.fcntl(0,fcntl.F_GETPATH,b'\\0'*1024).split(b'\\0')[0])"],
  { stdio: [fd, "pipe", "ignore"], windowsHide: true, timeout: 10_000 });
  let result = "";
  child.stdout!.setEncoding("utf8").on("data", chunk => { result += chunk; });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new ValidationError(t("backend.storage.pathExceedsRoot"))));
  });
  return windows ? result.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "") : result;
}

export async function openManagedLocalFile(basePath: string, relativePath: string, directory = false) {
  const target = resolveStoragePathWithinBase(basePath, relativePath);
  if (!target.ok) throw new ValidationError(target.reason);
  const expected = path.resolve(await realpath(expandStorageBasePath(basePath)), relativePath);
  const handle = await open(target.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (path.relative(expected, await openedPath(handle.fd)) !== "" ||
        !(directory ? (await handle.stat()).isDirectory() : (await handle.stat()).isFile())) {
      throw new ValidationError(t("backend.storage.pathExceedsRoot"));
    }
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

// On Windows tar cannot chdir to an inherited descriptor. Keep the canonical directory chain open
// without write/delete sharing while tar uses it as its working directory.
const pinWindowsDirectory = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public class ArchiveDirectory {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
}
'@
$handles=New-Object System.Collections.ArrayList
try {
  $current=$env:VCH_ARCHIVE_ROOT
  $parts=@('') + @($env:VCH_ARCHIVE_MEMBER.Split('/'))
  foreach ($part in $parts) {
    if ($part) { $current=[IO.Path]::Combine($current,$part) }
    $handle=[ArchiveDirectory]::CreateFile($current,128,1,[IntPtr]::Zero,3,0x02200000,[IntPtr]::Zero)
    if ($handle.IsInvalid) { throw 'Could not pin directory' }
    [void]$handles.Add($handle)
    $attributes=[IO.File]::GetAttributes($current)
    if (!(($attributes -band 16)) -or ($attributes -band 1024)) { throw 'Directory changed' }
  }
  [Console]::Write('1')
  [Console]::Out.Flush()
  [void][Console]::ReadLine()
} finally { foreach ($handle in $handles) { $handle.Dispose() } }`;

export async function pinLocalArchiveDirectory(basePath: string, relativePath: string) {
  if (process.platform !== "win32") {
    const handle = await openManagedLocalFile(basePath, relativePath, true);
    return { fd: handle.fd, cwd: undefined, close: () => handle.close() };
  }
  const target = resolveStoragePathWithinBase(basePath, relativePath);
  if (!target.ok) throw new ValidationError(target.reason);
  const root = await realpath(expandStorageBasePath(basePath));
  const guard = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", pinWindowsDirectory], {
    env: { ...process.env, VCH_ARCHIVE_ROOT: root, VCH_ARCHIVE_MEMBER: relativePath },
    stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
  });
  guard.stdin.on("error", () => {});
  const closed = new Promise<void>(resolve => guard.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(new ValidationError(t("backend.storage.pathExceedsRoot")));
      const timer = setTimeout(() => { guard.kill(); failed(); }, 15_000);
      guard.once("close", () => { clearTimeout(timer); failed(); });
      guard.once("error", failed);
      guard.stdout.once("data", data => { clearTimeout(timer); if (data.toString() === "1") resolve(); else failed(); });
    });
    return { fd: undefined, cwd: path.join(root, relativePath), close: async () => { guard.stdin.end(); await closed; } };
  } catch (error) { guard.stdin.end(); throw error; }
}
