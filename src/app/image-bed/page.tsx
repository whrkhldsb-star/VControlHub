import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import ImageBedPageClient from "./image-bed-page-client";

export const dynamic = "force-dynamic";

export default async function ImageBedPage() {
	const session = await requirePagePermission("image:read", { redirectTo: "/image-bed" });
	const canWrite = sessionHasPermission(session, "image:write");
	// Both DELETE /api/images/[id] and POST /api/images/batch require image:write.
	const canDelete = canWrite;
	const canListAll = sessionHasPermission(session, "team:manage") || sessionHasPermission(session, "media:manage");
	return <ImageBedPageClient canWrite={canWrite} canDelete={canDelete} canListAll={canListAll} />;
}
