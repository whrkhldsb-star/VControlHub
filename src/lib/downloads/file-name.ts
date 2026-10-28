/**
 * Whether one path segment of a downloaded file is a plain name the VPS and the index can hold. The same rule
 * serves the torrent's transfer manifest (checked before anything is sent) and the file index (checked after):
 * with two different rules a name the first accepted ("Wait... What.mp4") rolled back the second, after the
 * whole torrent had already been copied to the server.
 */
export function isPlainDownloadName(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  // "..." and "a..b" are ordinary names: only a whole "." / ".." segment can climb out of a folder, and
  // separators are refused outright.
  if (/[\\/\0\r\n]/.test(segment) || /^[A-Za-z]:/.test(segment)) return false;
  return Buffer.byteLength(segment) <= 255;
}
