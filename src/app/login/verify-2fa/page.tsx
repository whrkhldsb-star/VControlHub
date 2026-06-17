import { getPending2faCookieName } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n/translations";
import { Verify2faForm } from "./verify-2fa-form";

type Verify2faPageProps = {
	searchParams?: Promise<{ next?: string; error?: string }>;
};

function resolveErrorMessage(error?: string) {
	if (error === "expired") return "验证会话已过期，请重新登录";
	if (error === "invalid") return "验证码错误，请重试";
	if (error === "rate_limited") return "验证尝试过于频繁，请稍后再试";
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
		<main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050508] text-white">
			{/* Background effects */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.06),transparent_35%),linear-gradient(180deg,#08080c_0%,#050508_100%)]" />
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

			<div className="relative w-full max-w-md px-6">
				<div className="rounded-2xl bg-white/[0.03] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-8">
					<div className="mb-7">
						<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10">
							<svg className="h-6 w-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
						</div>
						<h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">{t("auth.two-factor")}</h2>
						<p className="mt-2 text-sm text-white/40">{t("login.verify2faDescription")}</p>
					</div>

					<Verify2faForm nextPath={nextPath} error={error} />

					<div className="mt-5 border-t border-white/[0.06] pt-4">
						<a
							href="/login"
							className="text-xs text-white/30 transition-colors hover:text-white light:hover:text-slate-900/50"
						>
							{t("login.verify2faBackToLogin")}
						</a>
					</div>
				</div>
			</div>
		</main>
	);
}
