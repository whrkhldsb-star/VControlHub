import { requireSession } from "@/lib/auth/require-session";
import ApiDocsPageClient from "./api-docs-page-client";

export default async function ApiDocsPage() {
  await requireSession("/api-docs");
  return <ApiDocsPageClient />;
}
