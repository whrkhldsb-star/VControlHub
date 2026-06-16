import Link from "next/link";

import { t } from "@/lib/i18n/translations";

export default function NotFoundPage() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
			<div className="max-w-md text-center">
				<div className="text-6xl mb-4">🔍</div>
				<h1 className="text-3xl font-semibold text-white">{t("notFound.title")}</h1>
				<p className="mt-3 text-[var(--text-secondary)]">{t("notFound.description")}</p>
				<Link
					href="/"
					data-tone="cyan"
					className="mt-6 inline-block rounded-full border border-cyan-400/30 px-6 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
				>
					{t("notFound.returnHome")}
				</Link>
			</div>
		</main>
	);
}
