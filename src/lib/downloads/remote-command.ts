import { shellQuote } from "@/lib/shell-quote";
import type { DownloadSourceResolution } from "@/lib/downloads/source-url";
export { shellQuote };

export function toRemoteChildPath(parentPath: string, childName: string): string {
  return `${parentPath.replace(/\/$/, "")}/${childName}`;
}

export function toScpTarget(username: string, host: string, remoteFilePath: string): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${username}@${formattedHost}:${remoteFilePath}`;
}

function safeTaskFileStem(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_-]/g, "_");
}

function cancelFileFor(safeTaskId: string) {
  return `/tmp/app-dl-${safeTaskId}.cancel`;
}

type DirectDownloadCommandInput = {
  taskId: string;
  url: string;
  targetPath: string;
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
  fileName,
  sourceResolution,
  maxBytes = null,
  maxSpeedKb = null,
}: DirectDownloadCommandInput): string {
  const safeTaskId = safeTaskFileStem(taskId);
  const pidFile = `/tmp/app-dl-${safeTaskId}.pid`;
  const logFile = `/tmp/app-dl-${safeTaskId}.log`;
  const exitFile = `${pidFile}.exit`;
  const outputPath = fileName ? toRemoteChildPath(targetPath, fileName) : "";
  const resolvedAddress = sourceResolution.address.includes(":")
    ? `[${sourceResolution.address}]`
    : sourceResolution.address;
  const resolveEntry = `${sourceResolution.hostname}:${sourceResolution.port}:${resolvedAddress}`;

  const script = [
    "set +e",
    `download_url=${shellQuote(url)}`,
    `target_dir=${shellQuote(targetPath)}`,
    `output_path=${shellQuote(outputPath)}`,
    `log_file=${shellQuote(logFile)}`,
    `pid_file=${shellQuote(pidFile)}`,
    `exit_file=${shellQuote(exitFile)}`,
    `resolve_entry=${shellQuote(resolveEntry)}`,
    `max_bytes=${maxBytes === null ? "" : maxBytes.toString()}`,
    `limit_rate=${maxSpeedKb && Number.isInteger(maxSpeedKb) && maxSpeedKb > 0 ? `${maxSpeedKb}k` : ""}`,
    // The detached process persists its own identity, even if the controller
    // dies before it can store the SSH response in PostgreSQL.
    'echo $$ >"$pid_file"',
    // A cancel that ran before this process existed left a tombstone: never
    // start the transfer (see buildDirectDownloadStopCommand).
    `cancel_file=${shellQuote(cancelFileFor(safeTaskId))}`,
    'if [ -e "$cancel_file" ]; then rm -f "$pid_file"; exit 130; fi',
    "if [ -z \"$output_path\" ]; then",
    "  clean_url=${download_url%%[?#]*}",
    "  base_name=${clean_url##*/}",
    "  if [ -z \"$base_name\" ] || [ \"$base_name\" = \"$clean_url\" ]; then base_name=download; fi",
    "  output_path=${target_dir%/}/$base_name",
    "fi",
    `partial_suffix=${shellQuote(`.vch-${safeTaskId}.part`)}`,
    'partial_path=$output_path$partial_suffix',
    "if command -v curl >/dev/null 2>&1; then",
    // Pin the public DNS result and fail on any redirect. A redirect target
    // has not passed the controller's DNS allowlist and may be an intranet IP.
    // --max-filesize stops a too-large file early when its size is announced.
    "  curl --fail --show-error -L --max-redirs 0 --proto =https,http --proto-redir =https,http ${max_bytes:+--max-filesize \"$max_bytes\"} ${limit_rate:+--limit-rate \"$limit_rate\"} --resolve \"$resolve_entry\" -o \"$partial_path\" \"$download_url\" >\"$log_file\" 2>&1",
    "else",
    "  echo \"ERROR: curl is required for DNS-pinned downloads\" >\"$log_file\"",
    "  false",
    "fi",
    "status=$?",
    // Unannounced sizes (and curl before 8.4) are only known at the end.
    'if [ "$status" = 0 ] && [ -n "$max_bytes" ] && [ "$(wc -c <"$partial_path")" -gt "$max_bytes" ]; then echo "ERROR: the file is larger than the storage limit allows" >>"$log_file"; status=63; fi',
    // Publish only complete files. Interrupted downloads never truncate the
    // destination; a retry uses its own task-owned staging file.
    'if [ "$status" = 0 ]; then mv -f -- "$partial_path" "$output_path"; status=$?; fi',
    'if [ "$status" != 0 ]; then rm -f -- "$partial_path"; fi',
    'echo $status >"$exit_file.tmp" && mv -f -- "$exit_file.tmp" "$exit_file"',
    "rm -f \"$pid_file\"",
    "exit $status",
  ].join("\n");

  return [
    `nohup bash -lc ${shellQuote(script)} >/dev/null 2>&1 &`,
    `echo $! > ${shellQuote(pidFile)}`,
    `cat ${shellQuote(pidFile)}`,
  ].join("\n");
}

export type DirectDownloadStopState = "STOPPED" | "NOT_RUNNING";

/**
 * Stop every process of one direct download and confirm none is left.
 *
 * `kill <pid>` of the detached `bash` alone is not enough: bash dies on
 * SIGTERM but its foreground curl is not signalled and keeps writing. The pid
 * marker is not needed either (and may be missing when the controller died
 * before storing it). Both processes carry the task-owned staging suffix
 * `.vch-<task>.part` in their command line (bash in its script, curl in `-o`),
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
  options: { cancel?: boolean } = {},
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
    `rm -f -- ${shellQuote(pidFile)} ${shellQuote(`${pidFile}.exit`)}`,
    'echo "$state"',
  ].join("\n");
}

/** True only for a stop command result that confirms no download process is left. */
export function parseDirectDownloadStopResult(result: { stdout: string; exitCode?: number | null }): DirectDownloadStopState | null {
  if (result.exitCode !== 0) return null;
  const last = result.stdout.trim().split(/\r?\n/).pop();
  return last === "STOPPED" || last === "NOT_RUNNING" ? last : null;
}

export function getDirectDownloadLogCommand(taskId: string): string {
  const safeTaskId = safeTaskFileStem(taskId);
  return `tail -5 -- ${shellQuote(`/tmp/app-dl-${safeTaskId}.log`)} 2>/dev/null`;
}
