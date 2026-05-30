import { requireSession } from "@/lib/auth/require-session";
import PreferencesPageClient from "./preferences-page-client";

export default async function PreferencesPage() {
  await requireSession("/preferences");
  return <PreferencesPageClient />;
}
