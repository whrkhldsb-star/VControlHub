import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** Node's fs.rename replaces existing destinations. Request the native exclusive flag. */
export const NO_REPLACE_RENAME_PYTHON = `import ctypes,errno,os,sys
src,dst=map(os.fsencode,sys.argv[1:])
if os.name == 'nt':
 os.rename(src,dst)
else:
 libc=ctypes.CDLL(None,use_errno=True)
 if sys.platform.startswith('linux') and hasattr(libc,'renameat2'):
  rc=libc.renameat2(-100,src,-100,dst,1)
 elif sys.platform=='darwin' and hasattr(libc,'renamex_np'):
  rc=libc.renamex_np(src,dst,4)
 else: raise OSError(errno.ENOTSUP,'Exclusive rename unavailable')
 if rc:
  code=ctypes.get_errno()
  if code in (errno.ENOSYS,errno.EINVAL,errno.ENOTSUP,errno.EXDEV): raise OSError(code,'Exclusive rename unavailable')
  raise OSError(code,os.strerror(code))`;

export async function renameLocalExclusive(from: string, to: string) {
  try {
    if (process.platform === "win32") {
      await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; if ([IO.Directory]::Exists($env:VCH_MOVE_FROM)) { [IO.Directory]::Move($env:VCH_MOVE_FROM,$env:VCH_MOVE_TO) } else { [IO.File]::Move($env:VCH_MOVE_FROM,$env:VCH_MOVE_TO) }"],
      { env: { ...process.env, VCH_MOVE_FROM: from, VCH_MOVE_TO: to }, timeout: 15_000 });
    } else {
      await promisify(execFile)("python3", ["-c", NO_REPLACE_RENAME_PYTHON, from, to], { timeout: 15_000 });
    }
  } catch (error) {
    // execFile's message includes the entire inline program. Only stderr
    // describes the syscall that failed.
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === "ENOENT" || /FileExistsError|already exists|Exclusive rename unavailable/i.test(failure.stderr ?? ""))
      throw new ConflictError(t("backend.storage.recycledDirectoryConflict"));
    if (/FileNotFoundError/.test(failure.stderr ?? "")) throw Object.assign(new Error("Source does not exist"), { code: "ENOENT" });
    throw error;
  }
}
