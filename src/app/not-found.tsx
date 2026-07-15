import Link from "next/link";

import { t } from "@/lib/i18n/translations";

export default function NotFoundPage() {
	return (
		<main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 text-[var(--text-primary)]">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,139,253,0.12),transparent_55%),var(--page-bg)]"
			/>
			<div className="relative w-full max-w-md rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl">
				<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-3xl" aria-hidden="true">
					🔍
				</div>
				<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">404</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{t("notFound.title")}</h1>
				<p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{t("notFound.description")}</p>
				<Link
					href="/"
					data-primary
					className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-6 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)]"
				>
					{t("notFound.returnHome")}
				</Link>
			</div>
		</main>
	);
}
