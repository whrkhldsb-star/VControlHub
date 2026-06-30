import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import ImageBedPageClient from "./image-bed-page-client";

export const revalidate = 60;

export default async function ImageBedPage() {
	const session = await requirePagePermission("image:read");
	const canWrite = sessionHasPermission(session, "image:write");
	const canDelete = sessionHasPermission(session, "storage:delete");
	return <ImageBedPageClient canWrite={canWrite} canDelete={canDelete} />;
}
