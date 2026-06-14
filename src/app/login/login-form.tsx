type LoginFormProps = {
	nextPath: string;
	error?: string;
};

const fieldClassName =
	"w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05)] outline-none transition-all duration-150 placeholder:text-white/25 focus:border-cyan-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-cyan-400/10 light:border-slate-200/80 light:shadow-sm light:placeholder:text-slate-400 light:focus:border-cyan-500/70 light:focus:bg-white light:focus:ring-cyan-500/10";

export function LoginForm({ nextPath, error }: LoginFormProps) {
	return (
		<form action="/api/login" method="post" className="space-y-4">
			<input type="hidden" name="next" value={nextPath} />

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-white" htmlFor="username">
					用户名
				</label>
				<input
					id="username"
					name="username"
					type="text"
					placeholder="输入用户名"
					autoComplete="username"
					className={fieldClassName}
				/>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-white" htmlFor="password">
					密码
				</label>
				<input
					id="password"
					name="password"
					type="password"
					placeholder="输入密码"
					autoComplete="current-password"
					className={fieldClassName}
				/>
			</div>

			<label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5 text-xs font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.03)] light:border-slate-200/80 light:shadow-sm">
				<span>记住登录 30 天，减少频繁跳转登录页</span>
				<input
					type="checkbox"
					name="remember"
					className="h-4 w-4 rounded border-white/20 bg-white/[0.06] text-cyan-400 focus:ring-cyan-400/40 light:focus:ring-cyan-500/30"
				/>
			</label>

			{error ? (
				<div role="alert" data-tone="rose" className="rounded-2xl border border-rose-400/15 px-4 py-2.5 text-sm font-medium text-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.08)] light:border-rose-200 light:bg-rose-50 light:shadow-sm">
					{error}
				</div>
			) : null}

			<button
				type="submit"
				className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_8px_20px_rgba(34,211,238,0.15)] transition-all duration-150 hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_12px_28px_rgba(34,211,238,0.25)] focus:outline-none focus:ring-4 focus:ring-cyan-400/40 light:from-cyan-500 light:to-blue-600 light:shadow-[0_12px_28px_rgba(14,116,144,0.22)] light:hover:shadow-[0_16px_34px_rgba(14,116,144,0.28)] light:focus:ring-cyan-500/20"
			>
				登录后台
			</button>
		</form>
	);
}
