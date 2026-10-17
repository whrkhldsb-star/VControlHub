/**
 * The storage root a new Linux server gets when none is given: a folder in
 * the login user's own home, the one place onboarding can always create it.
 * root's home is /root; other users' is /home/<user> on the usual cloud
 * images. A name that would not make a plain path segment keeps /root/drive.
 */
export function defaultStoragePath(username: string | null | undefined): string {
  const user = username?.trim() || "root";
  if (user === "root" || !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(user)) return "/root/drive";
  return `/home/${user}/drive`;
}
