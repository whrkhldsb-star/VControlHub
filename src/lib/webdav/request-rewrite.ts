/**
 * What the custom server (`src/server.ts`) changes on a WebDAV request before
 * Next's router sees it. Pure, so the entrypoint stays a thin caller.
 */

export const WEBDAV_ROUTE_PREFIX = "/api/webdav";

/**
 * Next.js App Router only dispatches standard HTTP methods. These verbs reach
 * `/api/webdav/*` as POST + X-HTTP-Method-Override.
 */
export const WEBDAV_OVERRIDE_METHODS: ReadonlySet<string> = new Set([
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
]);

function splitRequestTarget(url: string): { path: string; query: string } {
  const queryStart = url.indexOf("?");
  return queryStart < 0
    ? { path: url, query: "" }
    : { path: url.slice(0, queryStart), query: url.slice(queryStart) };
}

/** `/api/webdav` itself or a path below it; `/api/webdavx` is another route. */
export function isWebDavRequestTarget(url: string | undefined): boolean {
  const { path } = splitRequestTarget(url ?? "");
  return path === WEBDAV_ROUTE_PREFIX || path.startsWith(`${WEBDAV_ROUTE_PREFIX}/`);
}

/**
 * WebDAV names a collection with a trailing slash: clients send
 * `MKCOL /dav/new/` and `PROPFIND /dav/dir/`, and the hrefs this server lists
 * for collections end in one. Next answers every path that ends in "/" with a
 * 308 to the path without it, before the route runs, and WebDAV clients do not
 * follow a redirect for those verbs (litmus, cadaver and davfs2 stop at the
 * first MKCOL; Explorer and Finder cannot enter a folder). The route handler
 * names resources by their path segments either way, so the slash is dropped
 * here instead.
 */
export function stripWebDavTrailingSlash(url: string): string {
  if (!isWebDavRequestTarget(url)) return url;
  const { path, query } = splitRequestTarget(url);
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === path ? url : `${trimmed}${query}`;
}
