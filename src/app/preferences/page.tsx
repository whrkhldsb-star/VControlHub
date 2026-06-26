import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/require-session";

export default async function PreferencesPage() {
	await requireSession("/preferences");
	redirect("/settings#personal-preferences");
}
