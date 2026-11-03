import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import ImageBedPageClient from "./image-bed-page-client";

export const dynamic = "force-dynamic";

export default async function ImageBedPage() {
	const session = await requirePagePermission("image:read");
	const canWrite = sessionHasPermission(session, "image:write");
	// The DELETE route lets an uploader remove their own image with image:write (A5-12); the button follows.
	const canDelete = canWrite || sessionHasPermission(session, "storage:delete") || sessionHasPermission(session, "media:manage");
	const canListAll = sessionHasPermission(session, "team:manage") || sessionHasPermission(session, "media:manage");
	return <ImageBedPageClient canWrite={canWrite} canDelete={canDelete} canListAll={canListAll} />;
}
