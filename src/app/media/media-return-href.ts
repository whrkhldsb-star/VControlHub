/**
 * The list a detail page returns to, from its `?from=` parameter as the router hands it over — decoded already
 * (decoding it again turned the search "R&D" into "R" plus a parameter "D"), a list when the parameter is
 * repeated. Only an address of the media list itself is accepted.
 *
 * In a module of its own, without "use client": the detail page calls it while rendering on the server, and a
 * function exported by a client module cannot be called there (the page failed for every item when this lived
 * next to the card helpers).
 */
export function mediaReturnHref(from: string | string[] | undefined): string {
  const value = Array.isArray(from) ? from[0] : from;
  return value === "/media" || value?.startsWith("/media?") ? value : "/media";
}
