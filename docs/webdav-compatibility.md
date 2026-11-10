# WebDAV deployment and compatibility

## Two independent roles

- External WEBDAV storage: VControlHub connects to a public HTTPS provider using encrypted Basic/Bearer credentials. Browser requests use the hub proxy, never provider secrets.
- `/api/webdav/<nodeId>`: VControlHub exports supported storage through API-token Basic/Bearer authentication with storage grants and RBAC. This is not browser session authentication.

## Deployment requirement

Run the project's custom `src/server.ts` through the standard systemd/deploy scripts. It maps nonstandard HTTP methods into the App Router and drops the trailing slash of a collection URL (`MKCOL /api/webdav/<nodeId>/dir/`), which Next.js would otherwise answer with a 308 redirect that DAV clients do not follow. Ordinary `next start` or a Serverless deployment is not an equivalent WebDAV deployment.

`/api/webdav/` is outside the matcher of `src/proxy.ts`, and has to stay there. Next.js buffers the body of every request the proxy matches and passes the route only the first `proxyClientMaxBodySize` bytes without failing the request, so a larger `PUT` would be stored cut short and still answered `201`. Outside the proxy the body is streamed to storage at any size. The route therefore does what the proxy would have done for it: authentication is mandatory in the DAV handler, rate limiting is applied before it, and the route sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and HSTS itself. A `PUT` whose body ends before its `Content-Length` is refused and nothing is stored.

Read-only post-deployment check:

```sh
python3 scripts/webdav-http-smoke.py http://127.0.0.1:3000
```

This checks actual OPTIONS and raw PROPFIND/MKCOL/MOVE/COPY dispatch and Basic challenges without creating files or tokens. It is not an authenticated mount round trip.

## Supported and unsupported boundaries

- `OPTIONS` advertises DAV classes 1 and 2 because macOS Finder mounts a class 1 server read-only and Windows Explorer edits through `LOCK`. The locks are advisory tokens: `LOCK` hands one out and `UNLOCK` accepts it, but no request is refused for a missing or foreign token. Complete class 2 semantics are not provided.
- `MKCOL` on a path that already exists answers 405, as RFC 4918 requires; missing parent collections are created instead of answering 409. A request body on `MKCOL` is ignored.
- `PROPPATCH` is accepted and stores nothing (no dead properties); a `PROPFIND` body is not validated.
- External storage uses validated, pinned public DNS addresses and verified TLS; private endpoints and redirects are rejected intentionally.
- External directory listing uses Depth 1 with bounded XML and entry count. An incomplete/malformed response is not an empty directory and must not prune the index.
- Anonymous public file shares support proxy download and safe inline content. HTML/SVG do not execute as same-origin active content.
- Password shares use short-lived signed HttpOnly tickets bound to the share token; no application login is required.
- External WEBDAV directory tar archives are not implemented; the public page hides that action.
- Directory COPY, locking and advanced property editing are not claimed as full client compatibility.

## Evidence and external acceptance

Vitest includes a real local HTTP provider fixture for mkdir/upload/list/stat/read/stream/move/delete plus injected transport security/error tests. Mocks test application permissions, index consistency and share routing separately. These do not establish vendor certification.

The exported endpoint was run against real clients on 2026-11-10 (LOCAL storage node, custom server): rclone (`mkdir`, `copy`, `check`, `moveto`, `sync`, `purge`) and cadaver (collection create, 15 MB `put`/`get` round trip with equal checksums) work; `PUT` bodies of 15 MB and 200 MB are stored byte for byte. litmus 0.13 passes `http` 4/4, `basic` 13/16, `copymove` 8/13, `props` 20/30 and `locks` 22/32. What it still reports are the boundaries listed above: parent collections are created on demand, a collection `COPY` is refused, dead properties are not stored, locks are not enforced, and a malformed `PROPFIND` body or a `MKCOL` body is not rejected.

Nextcloud, Synology and Jianguoyun have not been tested with real accounts in this environment. Acceptance should use an isolated disposable directory and include Chinese/percent-encoded names, empty files, ranged media, revoked credentials, remote deletion/recreation and 401/403/423/507 responses. Do not use user files for destructive compatibility tests.
