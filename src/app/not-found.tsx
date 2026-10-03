
import { getServerLocale, t } from "@/lib/i18n/translations";
import { IconSearch } from "@/components/nav-icons";
import { ButtonLink } from "@/components/action-button";

export default async function NotFoundPage() {
	const locale = await getServerLocale();
	return (
		<div className="flex min-h-[80dvh] items-center justify-center px-6 text-[var(--text-primary)]">
			<div className="w-full max-w-sm text-center">
				<div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-[var(--shadow-xs)]" aria-hidden="true">
					<IconSearch size={22} />
				</div>
				<p className="font-mono text-xs font-medium text-[var(--accent)]">404</p>
				<h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{t("notFound.title", locale)}</h1>
				<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("notFound.description", locale)}</p>
				<ButtonLink variant="primary"
					href="/" className="mt-6">
					{t("notFound.returnHome", locale)}
				</ButtonLink>
			</div>
		</div>
	);
}
