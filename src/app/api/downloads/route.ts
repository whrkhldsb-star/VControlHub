/**
 * Downloads API route — thin barrel.
 *
 * The HTTP handlers (POST/GET/PATCH/DELETE) live in sibling modules:
 *  - route-post.ts   create download task (batch handling, dispatch w/ rollback)
 *  - route-get.ts    list tasks with aria2 progress sync
 *  - route-patch.ts  pause/resume/speed-limit/refresh (incl. remote SSH probing)
 *  - route-delete.ts cancel/purge task
 *
 * Route-level pure helpers (access checks, download-access shaping) live in
 * `@/lib/downloads/route-helpers`.
 *
 * Next.js App Router only loads `route.ts` as the route module, so we
 * re-export the handlers here.
 */

export { POST } from "./route-post";
export { GET } from "./route-get";
export { PATCH } from "./route-patch";
export { DELETE } from "./route-delete";

export const dynamic = "force-dynamic";
// guardMode: delegated
