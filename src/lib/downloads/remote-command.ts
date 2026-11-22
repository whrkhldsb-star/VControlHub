import { shellQuote } from "@/lib/shell-quote";
import type { DownloadSourceResolution } from "@/lib/downloads/source-url";
import { enterDownloadTargetDirectory } from "./target-path";
import { isPlainDownloadName } from "./file-name";

export { shellQuote };

export function toRemoteChildPath(parentPath: string, childName: string): string {
  return `${parentPath.replace(/\/$/, "")}/${childName}`;
}

export function toScpTarget(username: string, host: string, remoteFilePath: string): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${username}@${formattedHost}:${remoteFilePath}`;
}

export function safeTaskFileStem(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_-]/g, "_");
}

function cancelFileFor(safeTaskId: string) {
  return `/tmp/app-dl-${safeTaskId}.cancel`;
}

function openLaunchDirectory(taskId: string, create: boolean) {
  const directory = shellQuote("/tmp/app-dl-" + safeTaskFileStem(taskId) + ".start");
  return [
    `launch_dir=${directory}`,
    create ? 'mkdir -m 700 -- "$launch_dir" 2>/dev/null || [ -d "$launch_dir" ] || exit 65'
      : '[ -e "$launch_dir" ] || { [ ! -L "$launch_dir" ] && exit 0; exit 1; }',
    'exec 9<"$launch_dir" && [ ! -L "$launch_dir" ] && [ -d /proc/self/fd/9 ] && [ "$launch_dir" -ef /proc/self/fd/9 ] || exit 65',
    '[ "$(stat -Lc %u:%a /proc/self/fd/9)" = "$(id -u):700" ] || exit 65',
  ].join("\n");
}

export function directLaunchProbeCommand(taskId: string) {
  return openLaunchDirectory(taskId, false) + '\nif [ -s /proc/self/fd/9/started ]; then cat -- /proc/self/fd/9/started; fi';
}

// The receipt identifies the staging inode before rename. A controller can
// recognize it after a crash between rename and writing the successful exit.
export function directPublishReceiptMatches(exitFile: string, output: string) {
  return `[ -f ${output} ] && [ ! -L ${output} ] && [ "$(stat -c '%d:%i' -- ${output})" = "$(cat ${shellQuote(exitFile + ".publish")} 2>/dev/null)" ]`;
}

type DirectDownloadCommandInput = {
  taskId: string;
  url: string;
  targetPath: string;
  basePath: string;
  physicalTargetDir: string;
  fileName?: string | null;
  sourceResolution: DownloadSourceResolution;
  /** The creator's storage limit for this file (per-file limit or what the quota has left); null: none. */
  maxBytes?: bigint | null;
  /** The task's speed limit in KB/s (the form offers it for every download); null: none. */
  maxSpeedKb?: number | null;
};

export function buildDirectDownloadCommand({
  taskId,
  url,
  targetPath,
  basePath,
  physicalTargetDir,
  fileName,
  sourceResolution,
  maxBytes = null,
  maxSpeedKb = null,
}: DirectDownloadCommandInput): string {
  const safeTaskId = safeTaskFileStem(taskId);
  const pidFile = `/tmp/app-dl-${safeTaskId}.pid`;
  const logFile = `/tmp/app-dl-${safeTaskId}.log`;
  const exitFile = `${pidFile}.exit`;
  const name = fileName || new URL(url).pathname.split("/").pop() || "download";
  if (!isPlainDownloadName(name)) throw new Error("Invalid download file name");
  const resolvedAddress = sourceResolution.address.includes(":")
    ? `[${sourceResolution.address}]`
    : sourceResolution.address;
  const resolveEntry = sourceResolution.hostname === sourceResolution.address
    ? "" : `${sourceResolution.hostname}:${sourceResolution.port}:${resolvedAddress}`;

  // Retain only the response length. Headers can contain credentials.
  const lengthFilter = `awk 'BEGIN { IGNORECASE=0 } /^HTTP\\// { n="" } tolower($1)=="content-length:" { n=$2; sub(/\\r$/, "", n) } /^\\r?$/ && n ~ /^[0-9]+$/ { print n; fflush() }' >"$pid_file.total"`;
  const script = [
    "set +e",
    `download_url=${shellQuote(url)}`,
    `target_dir=${shellQuote(targetPath)}`,
    `output_path=${shellQuote("./" + name)}`,
    `log_file=${shellQuote(logFile)}`,
    `pid_file=${shellQuote(pidFile)}`,
    `exit_file=${shellQuote(exitFile)}`,
    `resolve_entry=${shellQuote(resolveEntry)}`,
    `max_bytes=${maxBytes === null ? "" : maxBytes.toString()}`,
    `limit_rate=${maxSpeedKb && Number.isInteger(maxSpeedKb) && maxSpeedKb > 0 ? `${maxSpeedKb}k` : ""}`,
    // The detached process persists its own identity, even if the controller
    // dies before it can store the SSH response in PostgreSQL.
    'echo $$ >/proc/self/fd/9/starting && mv -fT -- /proc/self/fd/9/starting /proc/self/fd/9/started || exit 1',
    'exec 9>&-',
    'echo $$ >"$pid_file"',
    // A cancel that ran before this process existed left a tombstone: never
    // start the transfer (see buildDirectDownloadStopCommand).
    `cancel_file=${shellQuote(cancelFileFor(safeTaskId))}`,
    'if [ -e "$cancel_file" ]; then rm -f "$pid_file"; exit 130; fi',
    `partial_suffix=${shellQuote(`.vch-${safeTaskId}.part`)}`,
    'partial_path=$output_path$partial_suffix',
    // Pin the staging inode before curl starts. Never reopen its pathname for writing.
    'transfer() {',
    '  [ "$(pwd -P)" = "$expected_dir" ] && [ "$(realpath -e -- "$target_dir")" = "$expected_dir" ] || return 1',
    '  [ ! -L "$output_path" ] && [ ! -e "$partial_path" ] && [ ! -L "$partial_path" ] || return 1',
    '  set -C',
    '  exec 3>"$partial_path" || return 1',
    '  set +C',
    '  [ -f /proc/self/fd/3 ] || return 1',
    // Pin the public DNS result and fail on any redirect. A redirect target
    // has not passed the controller's DNS allowlist and may be an intranet IP.
    // --max-filesize stops a too-large file early when its size is announced.
    `  (exec -a "curl $partial_suffix" curl --dump-header >(${lengthFilter}) --fail --show-error -L --max-redirs 0 --proto =https,http --proto-redir =https,http \${max_bytes:+--max-filesize \"$max_bytes\"} \${limit_rate:+--limit-rate \"$limit_rate\"} \${resolve_entry:+--resolve \"$resolve_entry\"} -o - "$download_url" >&3 2>"$log_file") || return $?`,
    // Measure the open inode, even if somebody replaced the directory entry during transfer.
    '  if [ -n "$max_bytes" ] && [ "$(stat -Lc %s /proc/self/fd/3)" -gt "$max_bytes" ]; then echo "ERROR: the file is larger than the storage limit allows" >>"$log_file"; return 63; fi',
    '  [ "$(pwd -P)" = "$expected_dir" ] && [ "$(realpath -e -- "$target_dir")" = "$expected_dir" ] || return 1',
    '  [ ! -L "$output_path" ] && [ ! -L "$partial_path" ] && [ "$partial_path" -ef /proc/self/fd/3 ] || return 1',
    '  exec 4>>"$exit_file.lock" && flock -x 4 || return 1',
    '  [ ! -e "$cancel_file" ] || return 130',
    '  receipt=$(mktemp -- "$exit_file.publish.XXXXXX") || return 1',
    '  stat -Lc "%d:%i" /proc/self/fd/3 >"$receipt" && mv -fT -- "$receipt" "$exit_file.publish" || return 1',
    '  mv -fT -- "$partial_path" "$output_path" && [ ! -L "$output_path" ] && [ "$output_path" -ef /proc/self/fd/3 ]',
    '}',
    'transfer',
    'status=$?',
    'if [ "$status" != 0 ] && [ ! -L "$partial_path" ] && [ "$partial_path" -ef /proc/self/fd/3 ]; then rm -f -- "$partial_path"; fi',
    'echo $status >"$exit_file.tmp" && mv -f -- "$exit_file.tmp" "$exit_file"',
    'rm -f "$pid_file" "$pid_file.total"',
    "exit $status",
  ].join("\n");

  return [
    // The script is bash; a host without it (Alpine) answered with an empty log
    // and a generic failure. Exit 127 names the cause (A5-14).
    "command -v bash >/dev/null 2>&1 || exit 127",
    "command -v flock >/dev/null 2>&1 || exit 65",
    openLaunchDirectory(taskId, true),
    "flock -x 9 || exit 65",
    "if [ -s /proc/self/fd/9/started ]; then cat -- /proc/self/fd/9/started; exit; fi",
    enterDownloadTargetDirectory(basePath, targetPath, physicalTargetDir),
    `nohup bash -lc ${shellQuote(script)} >/dev/null 2>&1 &`,
    // The child releases its inherited lock only after persisting its PID. Read that receipt before acknowledging dispatch.
    "exec 9>&-",
    openLaunchDirectory(taskId, false),
    "flock -w 10 -x 9 && cat -- /proc/self/fd/9/started",
  ].join("\n");
}

export type DirectDownloadStopState = "STOPPED" | "NOT_RUNNING" | "PUBLISHED";

/**
 * Stop every process of one direct download and confirm none is left.
 *
 * `kill <pid>` of the detached `bash` alone is not enough: bash dies on
 * SIGTERM but its foreground curl is not signalled and keeps writing. The pid
 * marker is not needed either (and may be missing when the controller died
 * before storing it). Both processes carry the task-owned staging suffix
 * `.vch-<task>.part` in their command line (bash in its script, curl in argv[0]),
 * a task-unique identity that cannot match a process that merely reused a pid.
 * The pattern is assembled at runtime so this command's own shell never
 * matches it.
 *
 * Prints STOPPED or NOT_RUNNING and exits 0 only when no such process remains;
 * anything else (exit != 0) means the outcome is unconfirmed.
 */
export function buildDirectDownloadStopCommand(
  taskId: string,
  targetPath?: string | null,
  options: { cancel?: boolean; fileName?: string | null } = {},
): string {
  const safeTaskId = safeTaskFileStem(taskId);
  const pidFile = `/tmp/app-dl-${safeTaskId}.pid`;
  return [
    `id=${shellQuote(safeTaskId)}`,
    `target_dir=${shellQuote(targetPath ?? "")}`,
    // A user cancel first leaves a task-owned tombstone, then looks for
    // processes. A spawn already under way is visible to pgrep (the token is
    // in its command line from the start); one that starts afterwards sees the
    // tombstone and exits before curl. So a cancel reported as confirmed can
    // no longer race a worker that dies between spawning and recording the pid.
    `exec 4>>${shellQuote(pidFile + ".exit.lock")} && flock -x 4 || exit 5`,
    `if [ "$(cat ${shellQuote(pidFile + ".exit")} 2>/dev/null)" = 0 ]; then echo PUBLISHED; exit 0; fi`,
    ...(targetPath && options.fileName && isPlainDownloadName(options.fileName)
      ? [`if ${directPublishReceiptMatches(pidFile + ".exit", shellQuote(toRemoteChildPath(targetPath, options.fileName)))}; then echo PUBLISHED; exit 0; fi`]
      : []),
    ...(options.cancel
      ? [`if ! : >${shellQuote(cancelFileFor(safeTaskId))} 2>/dev/null; then echo NO_TOMBSTONE; exit 5; fi`]
      : []),
    'pat="\\.vch-$id\\.part"',
    "command -v pgrep >/dev/null 2>&1 && command -v pkill >/dev/null 2>&1 || { echo NO_PGREP; exit 3; }",
    // pgrep: 0 = match, 1 = none, anything else = cannot tell.
    'alive() { pgrep -f -- "$pat" >/dev/null 2>&1; rc=$?; [ "$rc" -le 1 ] || { echo PGREP_FAILED; exit 3; }; return "$rc"; }',
    "state=NOT_RUNNING",
    "if alive; then",
    "  state=STOPPED",
    '  pkill -TERM -f -- "$pat" 2>/dev/null',
    "  i=0",
    '  while [ "$i" -lt 25 ] && alive; do sleep 0.2 2>/dev/null || sleep 1; i=$((i + 1)); done',
    '  if alive; then pkill -KILL -f -- "$pat" 2>/dev/null; sleep 1; fi',
    "  if alive; then echo STILL_RUNNING; exit 4; fi",
    "fi",
    'if [ -n "$target_dir" ] && [ -d "$target_dir" ]; then find "$target_dir" -maxdepth 1 -type f -name "*.vch-$id.part" -delete 2>/dev/null; fi',
    `rm -f -- ${shellQuote(pidFile)} ${shellQuote(`${pidFile}.exit`)} ${shellQuote(`${pidFile}.total`)}`,
    'echo "$state"',
  ].join("\n");
}

/** True only for a stop command result that confirms no download process is left. */
export function parseDirectDownloadStopResult(result: { stdout: string; exitCode?: number | null }): DirectDownloadStopState | null {
  if (result.exitCode !== 0) return null;
  const last = result.stdout.trim().split(/\r?\n/).pop();
  return last === "PUBLISHED" || last === "STOPPED" || last === "NOT_RUNNING" ? last : null;
}

export function getDirectDownloadLogCommand(taskId: string): string {
  const safeTaskId = safeTaskFileStem(taskId);
  return `tail -5 -- ${shellQuote(`/tmp/app-dl-${safeTaskId}.log`)} 2>/dev/null`;
}
