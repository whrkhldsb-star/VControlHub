import { firstSearchParam } from "@/lib/http/first-search-param";
import { getPending2faCookieName } from "@/lib/auth/session";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { safeRelativeRedirectPath } from "@/lib/http/redirect-path";
import { Verify2faForm } from "./verify-2fa-form";
import { ArrowLeft } from "@/components/icons";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

type Verify2faPageProps = {
	searchParams?: Promise<{ next?: string | string[]; error?: string | string[] }>;
};

function resolveErrorMessage(locale: Locale, error?: string) {
	if (error === "expired") return t("login.verify2faExpired", locale);
	if (error === "invalid") return t("login.verify2faInvalid", locale);
	if (error === "rate_limited") return t("login.verify2faRateLimited", locale);
	return undefined;
}

export default async function Verify2faPage({ searchParams }: Verify2faPageProps) {
	const locale = await getServerLocale();
	const resolvedSearchParams = (await searchParams) ?? {};

	const rawNext = firstSearchParam(resolvedSearchParams.next) ?? "/";
	// Same guard as /api/login: only same-origin relative paths (block open
	// redirects, including the backslash `/\host` form).
	const nextPath = safeRelativeRedirectPath(rawNext);
	// Signing in again lands where the person was going, not on the home page.
	const loginHref = nextPath === "/" ? "/login" : `/login?next=${encodeURIComponent(nextPath)}`;

	// Check if the pending 2FA cookie exists — if not, redirect to login
	const cookieStore = await cookies();
	const pendingCookie = cookieStore.get(getPending2faCookieName());
	if (!pendingCookie?.value) {
		redirect(`${loginHref}${nextPath === "/" ? "?" : "&"}error=expired`);
	}

	const error = resolveErrorMessage(locale, firstSearchParam(resolvedSearchParams.error));

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden text-[var(--text-primary)]">
			{/* Background effects */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--accent-bg),transparent_50%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent)_6%,transparent),transparent_35%),var(--page-bg)]" />
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

			{/* As on the sign-in page: the language and the theme can be chosen before signing in. */}
			<div className="absolute right-4 top-4 z-10 flex items-center gap-1 sm:right-6 sm:top-6">
				<ThemeToggle compact />
				<LanguageToggle compact />
			</div>

			<div className="relative w-full max-w-md px-4 py-16 sm:px-6">
				<div data-card="" className="p-5 sm:p-6">
					<div className="mb-7">
						<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
							<svg className="h-6 w-6 text-[var(--accent)]" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
						</div>
						<p className="text-xs font-semibold text-[var(--accent)]">{t("login.verify2faEyebrow", locale)}</p>
						<h1 className="ui-title-page mt-2">{t("auth.two-factor", locale)}</h1>
						<p className="mt-2 text-sm text-[var(--text-secondary)]">{t("login.verify2faDescription", locale)}</p>
					</div>

					<Verify2faForm nextPath={nextPath} error={error} />

					<p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">{t("login.verify2faLostDevice", locale)}</p>

					<div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
						<Link
							href={loginHref}
							className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
						>
							<ArrowLeft size={14} aria-hidden />
							{t("login.verify2faBackToLogin", locale)}
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
