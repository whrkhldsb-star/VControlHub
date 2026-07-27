/**
 * Shared byte-size formatter used by storage, media, download, monitor and
 * quota surfaces. Accepts DB strings and bigint values without forcing each
 * caller to reimplement unit selection.
 */
export type ByteValue = bigint | number | string | null | undefined;

export type FormatBytesOptions = {
  fallback?: string;
  zero?: string;
};

export function formatBytes(bytes: ByteValue, options: FormatBytesOptions = {}): string {
  const { fallback = "—", zero } = options;
  if (bytes === null || bytes === undefined || bytes === "") return fallback;

  const parsed = typeof bytes === "string" ? Number(bytes) : bytes;
  const numeric = typeof parsed === "bigint" ? Number(parsed) : parsed;
  if (!Number.isFinite(numeric)) return typeof bytes === "string" ? bytes : fallback;
  if (numeric === 0 && zero !== undefined) return zero;

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Math.abs(numeric);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : i <= 2 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/** Rate label helper for monitor traffic samples. */
export function formatBytesPerSecond(bytesPerSecond: ByteValue, options: FormatBytesOptions = {}): string {
  return `${formatBytes(bytesPerSecond, options)}/s`;
}
