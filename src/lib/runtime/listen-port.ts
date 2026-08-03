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
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a valid TCP port`);
  }
  return port;
}
