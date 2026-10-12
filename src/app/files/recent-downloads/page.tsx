import { requirePagePermission } from "@/lib/auth/page-guard";
import { FilesRecentDownloadsClient } from "./recent-downloads-client";

export const dynamic = "force-dynamic";

/**
 * Server entry so an invalid or expired session is sent to /login like every
 * other files page, instead of rendering the client shell and surfacing the
 * API's 401 as an error message.
 */
export default async function FilesRecentDownloadsPage() {
  await requirePagePermission("storage:read", { redirectTo: "/files/recent-downloads" });
  return <FilesRecentDownloadsClient />;
}
