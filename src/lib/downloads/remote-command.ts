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

type DirectDownloadCommandInput = {
  taskId: string;
  url: string;
  targetPath: string;
  fileName?: string | null;
  sourceResolution: DownloadSourceResolution;
};

export function buildDirectDownloadCommand({
  taskId,
  url,
  targetPath,
  fileName,
  sourceResolution,
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
    "if [ -z \"$output_path\" ]; then",
    "  clean_url=${download_url%%[?#]*}",
    "  base_name=${clean_url##*/}",
    "  if [ -z \"$base_name\" ] || [ \"$base_name\" = \"$clean_url\" ]; then base_name=download; fi",
    "  output_path=${target_dir%/}/$base_name",
    "fi",
    "if command -v curl >/dev/null 2>&1; then",
    // Pin the public DNS result and fail on any redirect. A redirect target
    // has not passed the controller's DNS allowlist and may be an intranet IP.
    "  curl --fail --show-error -L --max-redirs 0 --proto =https,http --proto-redir =https,http --resolve \"$resolve_entry\" -o \"$output_path\" \"$download_url\" >\"$log_file\" 2>&1",
    "else",
    "  echo \"ERROR: curl is required for DNS-pinned downloads\" >\"$log_file\"",
    "  false",
    "fi",
    "status=$?",
    "echo $status >\"$exit_file\"",
    "rm -f \"$pid_file\"",
    "exit $status",
  ].join("\n");

  return [
    `nohup bash -lc ${shellQuote(script)} >/dev/null 2>&1 &`,
    `echo $! > ${shellQuote(pidFile)}`,
    `cat ${shellQuote(pidFile)}`,
  ].join("\n");
}

export function getDirectDownloadLogCommand(taskId: string): string {
  const safeTaskId = safeTaskFileStem(taskId);
  return `tail -5 -- ${shellQuote(`/tmp/app-dl-${safeTaskId}.log`)} 2>/dev/null`;
}
