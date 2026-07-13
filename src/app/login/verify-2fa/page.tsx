import { getPending2faCookieName } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n/translations";
import { Verify2faForm } from "./verify-2fa-form";

type Verify2faPageProps = {
	searchParams?: Promise<{ next?: string; error?: string }>;
};

function resolveErrorMessage(error?: string) {
	if (error === "expired") return t("login.verify2faExpired");
	if (error === "invalid") return t("login.verify2faInvalid");
	if (error === "rate_limited") return t("login.verify2faRateLimited");
	return undefined;
}

export default async function Verify2faPage({ searchParams }: Verify2faPageProps) {
	const resolvedSearchParams = (await searchParams) ?? {};

	// Check if the pending 2FA cookie exists — if not, redirect to login
	const cookieStore = await cookies();
	const pendingCookie = cookieStore.get(getPending2faCookieName());
	if (!pendingCookie?.value) {
		redirect("/login?error=expired");
	}

	const nextPath = resolvedSearchParams.next ?? "/";
	const error = resolveErrorMessage(resolvedSearchParams.error);

	return (
		<main className="relative flex min-h-screen items-center justify-center overflow-hidden text-[var(--text-primary)]">
			{/* Background effects */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--accent-bg),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.06),transparent_35%),var(--page-bg)]" />
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

			<div className="relative w-full max-w-md px-6">
				<div className="rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] p-6 shadow-[var(--shadow-lg)] backdrop-blur-xl sm:p-8">
					<div className="mb-7">
						<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
							<svg className="h-6 w-6 text-[var(--accent)]" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
						</div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">2FA</p>
						<h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">{t("auth.two-factor")}</h2>
						<p className="mt-2 text-sm text-[var(--text-secondary)]">{t("login.verify2faDescription")}</p>
					</div>

					<Verify2faForm nextPath={nextPath} error={error} />

					<div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
						<a
							href="/login"
							className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
						>
							{t("login.verify2faBackToLogin")}
						</a>
					</div>
				</div>
			</div>
		</main>
	);
}
