import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PermissionDenied } from "@/components/page-shell";
import ImageBedPageClient from "./image-bed-page-client";

export default async function ImageBedPage() {
  const session = await requireSession("/image-bed");
  if (!sessionHasPermission(session, "image:read")) return <PermissionDenied />;
  return <ImageBedPageClient />;
}
