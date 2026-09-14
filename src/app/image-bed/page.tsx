import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import ImageBedPageClient from "./image-bed-page-client";

export const dynamic = "force-dynamic";

export default async function ImageBedPage() {
	const session = await requirePagePermission("image:read");
	const canWrite = sessionHasPermission(session, "image:write");
	const canDelete = sessionHasPermission(session, "storage:delete");
	const canListAll = sessionHasPermission(session, "team:manage") || sessionHasPermission(session, "media:manage");
	return <ImageBedPageClient canWrite={canWrite} canDelete={canDelete} canListAll={canListAll} />;
}
