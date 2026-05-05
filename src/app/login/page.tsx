import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type LoginPageProps = {
	searchParams?: Promise<{ next?: string; error?: string }>;
};

function resolveErrorMessage(error?: string) {
	if (error === "invalid") {
		return "用户名或密码错误";
	}
	if (error === "system") {
		return "登录服务暂时不可用，请稍后再试";
	}
	if (error === "rate_limited") {
		return "登录尝试过于频繁，请稍后再试";
	}
	return undefined;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
	const resolvedSearchParams = (await searchParams) ?? {};
	const nextPath = resolvedSearchParams.next ?? "/";
	const error = resolveErrorMessage(resolvedSearchParams.error);
	const publicLabel = process.env.NEXT_PUBLIC_APP_PUBLIC_LABEL ?? "VPS 管理与分布式云盘";

	return (
		<main className="relative min-h-screen overflow-hidden bg-[#050508] text-white">
			{/* Background effects */}
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.06),transparent_35%),linear-gradient(180deg,#08080c_0%,#050508_100%)]" />
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

			{/* Grid pattern overlay */}
			<div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

			<div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 lg:px-10">
				<div className="grid w-full gap-12 lg:grid-cols-[1fr_400px] lg:items-center">
					{/* Left: Branding */}
					<section className="max-w-xl">
						<div className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-white/50 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
							<div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
							{publicLabel}
						</div>
						<h1 className="mt-6 text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl">
							统一管控<span className="text-cyan-400">.</span>
						</h1>
						<p className="mt-4 max-w-md text-base leading-7 text-white/40">
							VPS 节点管理、命令审批执行与分布式云盘，一站掌控。
						</p>

						<div className="mt-10 grid gap-3 sm:grid-cols-3">
							<FeatureCard icon={
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
							} title="VPS 管理" desc="SSH 密钥认证" />
							<FeatureCard icon={
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
							} title="安全审批" desc="命令执行管控" />
							<FeatureCard icon={
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.926-9.937A5.5 5.5 0 008.5 9.5 5.5 5.5 0 003 15z" /></svg>
							} title="分布式云盘" desc="多节点存储" />
						</div>
					</section>

					{/* Right: Login Form */}
					<section className="rounded-2xl bg-white/[0.03] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_30px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-8">
						<div className="mb-7">
							<p className="text-[11px] uppercase tracking-[0.2em] text-white/30 font-medium">Secure Sign In</p>
							<h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.03em] text-white">欢迎回来</h2>
						</div>
						<LoginForm nextPath={nextPath} error={error} />
					</section>
				</div>
			</div>
		</main>
	);
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
	return (
		<div className="rounded-xl bg-white/[0.03] p-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur">
			<div className="text-cyan-400/70">{icon}</div>
			<div className="mt-2 text-sm font-medium text-white/80">{title}</div>
			<div className="mt-0.5 text-xs text-white/30">{desc}</div>
		</div>
	);
}
