/**
 * Shared byte-size formatter used by VPS backup records, server monitor
 * network stats and recycle-bin file sizes. Accepts number or DB string,
 * returns "—" for null/empty so callers can pass nullable DB columns directly.
 */
export function formatBytes(bytes: number | string | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === "") return "—";
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (Number.isNaN(n)) return typeof bytes === "string" ? bytes : "—";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : i <= 2 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}
