import { getPublicLabel, getSiteName } from "@/lib/branding";
import { LoginForm } from "./login-form";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

type LoginPageProps = {
	searchParams?: Promise<{ next?: string; error?: string; minutes?: string }>;
};

function resolveErrorMessage(locale: Locale, error?: string, minutes?: string) {
	if (error === "invalid") {
		return t("login.error.invalid", locale);
	}
	if (error === "system") {
		return t("login.error.system", locale);
	}
	if (error === "rate_limited") {
		return t("login.error.rateLimited", locale);
	}
	if (error === "locked") {
		const min = minutes ? `${minutes} ${locale === "zh" ? "分钟" : "minutes"}` : t("login.error.lockedDefault", locale);
		return t("login.error.locked", locale).replace("{min}", min);
	}
	return undefined;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const resolvedSearchParams = (await searchParams) ?? {};
	const nextPath = resolvedSearchParams.next ?? "/";
	const locale = await getServerLocale();
	const error = resolveErrorMessage(locale, resolvedSearchParams.error, resolvedSearchParams.minutes);
	const publicLabel = getPublicLabel();
	const siteName = getSiteName();

	return (
		<main className="relative min-h-screen overflow-hidden bg-[#050508] text-white">
			{/* Background effects */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.06),transparent_35%),linear-gradient(180deg,#08080c_0%,#050508_100%)] light:bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.18),transparent_48%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.14),transparent_36%),linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)]" />
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent light:via-cyan-300/50" />

			{/* Grid pattern overlay */}
			<div
				className="absolute inset-0 opacity-[0.015] light:opacity-[0.08]"
				style={{
					backgroundImage:
						"linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
					backgroundSize: "60px 60px",
				}}
			/>

			<div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 lg:px-10">
				<div className="grid w-full gap-12 lg:grid-cols-[1fr_400px] lg:items-center">
					{/* Left: Branding */}
					<section className="max-w-xl">
						<div className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)] light:border light:border-cyan-200 light:shadow-sm light:shadow-cyan-100/50 light:backdrop-blur">
							<div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.55)] light:bg-cyan-500 light:shadow-[0_0_8px_rgba(6,182,212,0.55)]" />
							{publicLabel}
						</div>
						<h1 className="mt-6 text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl">
							{siteName}<span className="text-cyan-400">.</span>
						</h1>
						<p className="mt-4 max-w-md text-base leading-7 text-white">
							{publicLabel}{t("login.branding.tagline", locale)}
						</p>

						<div className="mt-10 grid gap-3 sm:grid-cols-3">
							<FeatureCard
								icon={
									<svg width="20" height="20" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
								}
								title={t("login.feature.vps.title", locale)}
								desc={t("login.feature.vps.desc", locale)}
							/>
							<FeatureCard
								icon={
									<svg width="20" height="20" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
								}
								title={t("login.feature.approval.title", locale)}
								desc={t("login.feature.approval.desc", locale)}
							/>
							<FeatureCard
								icon={
									<svg width="20" height="20" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.926-9.937A5.5 5.5 0 0 0 8.5 9.5 5.5 5.5 0 0 0 3 15z" /></svg>
								}
								title={t("login.feature.cloud.title", locale)}
								desc={t("login.feature.cloud.desc", locale)}
							/>
						</div>
					</section>

					{/* Right: Login Form */}
					<section className="rounded-[1.75rem] bg-white/[0.03] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-8 light:border light:shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
						<div className="mb-7">
							<p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white">{t("login.branding.signInTag", locale)}</p>
							<h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.03em] text-white">{t("login.branding.welcome", locale)}</h2>
							<p className="mt-2 text-sm text-white">{t("login.branding.subtitle", locale)}</p>
						</div>
						<LoginForm nextPath={nextPath} error={error} locale={locale} />
					</section>
				</div>
			</div>
		</main>
	);
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
	return (
		<div className="rounded-2xl bg-white/[0.03] p-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur light:border light:shadow-sm light:shadow-slate-200/70">
			<div className="text-cyan-400/75">{icon}</div>
			<div className="mt-2 text-sm font-semibold text-white/82">{title}</div>
			<div className="mt-0.5 text-xs text-white">{desc}</div>
		</div>
	);
}
