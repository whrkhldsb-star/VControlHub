# WebDAV deployment and compatibility

## Two independent roles

- External WEBDAV storage: VControlHub connects to a public HTTPS provider using encrypted Basic/Bearer credentials. Browser requests use the hub proxy, never provider secrets.
- `/api/webdav/<nodeId>`: VControlHub exports supported storage through API-token Basic/Bearer authentication with storage grants and RBAC. This is not browser session authentication.

## Deployment requirement

Run the project's custom `src/server.ts` through the standard systemd/deploy scripts. It maps nonstandard HTTP methods into the App Router. Ordinary `next start` or a Serverless deployment is not an equivalent WebDAV deployment. Keep `/api/webdav/` out of session-cookie middleware; authentication remains mandatory in the DAV handler.

Read-only post-deployment check:

```sh
python3 scripts/webdav-http-smoke.py http://127.0.0.1:3000
```

This checks actual OPTIONS and raw PROPFIND/MKCOL/MOVE/COPY dispatch and Basic challenges without creating files or tokens. It is not an authenticated mount round trip.

## Supported and unsupported boundaries

- DAV class 1 only; locking/UNLOCK and complete WebDAV class 2 semantics are not advertised.
- External storage uses validated, pinned public DNS addresses and verified TLS; private endpoints and redirects are rejected intentionally.
- External directory listing uses Depth 1 with bounded XML and entry count. An incomplete/malformed response is not an empty directory and must not prune the index.
- Anonymous public file shares support proxy download and safe inline content. HTML/SVG do not execute as same-origin active content.
- Password shares use short-lived signed HttpOnly tickets bound to the share token; no application login is required.
- External WEBDAV directory tar archives are not implemented; the public page hides that action.
- Directory COPY, locking and advanced property editing are not claimed as full client compatibility.

## Evidence and external acceptance

Vitest includes a real local HTTP provider fixture for mkdir/upload/list/stat/read/stream/move/delete plus injected transport security/error tests. Mocks test application permissions, index consistency and share routing separately. These do not establish vendor certification.

Nextcloud, Synology and Jianguoyun have not been tested with real accounts in this environment. Acceptance should use an isolated disposable directory and include Chinese/percent-encoded names, empty files, ranged media, revoked credentials, remote deletion/recreation and 401/403/423/507 responses. Do not use user files for destructive compatibility tests.
