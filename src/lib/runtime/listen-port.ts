/**
 * Type guard for a usable TCP port: an integer in 1..65535 inclusive.
 * Shared by every inline `Number.isInteger(p) && p >= 1 && p <= 65535`
 * check that used to live in aria2, quick-service, rdp, sync and ai modules.
 */
export function isValidTcpPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function parseTcpPort(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const text = value?.trim() || String(fallback);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} must be a valid TCP port`);
  }

  const port = Number(text);
  if (!isValidTcpPort(port)) {
    throw new Error(`${label} must be a valid TCP port`);
  }
  return port;
}
