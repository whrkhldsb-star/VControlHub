type LoginFormProps = {
	nextPath: string;
	error?: string;
};

export function LoginForm({ nextPath, error }: LoginFormProps) {
	return (
		<form action="/api/login" method="post" className="space-y-4">
			<input type="hidden" name="next" value={nextPath} />

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="username">
					用户名
				</label>
				<input
					id="username"
					name="username"
					type="text"
					placeholder="输入用户名"
					autoComplete="username"
					className="w-full rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white shadow-[0_0_0_1px_rgba(255,255,255,0.07)] outline-none transition-all duration-150 placeholder:text-white/20 focus:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_0_0_4px_rgba(34,211,238,0.08)] focus:bg-white/[0.06]"
				/>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="password">
					密码
				</label>
				<input
					id="password"
					name="password"
					type="password"
					placeholder="输入密码"
					autoComplete="current-password"
					className="w-full rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white shadow-[0_0_0_1px_rgba(255,255,255,0.07)] outline-none transition-all duration-150 placeholder:text-white/20 focus:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_0_0_4px_rgba(34,211,238,0.08)] focus:bg-white/[0.06]"
				/>
			</div>

			{error ? (
				<div className="rounded-xl bg-rose-500/[0.08] px-4 py-2.5 text-sm text-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.15)]">
					{error}
				</div>
			) : null}

			<button
				type="submit"
				className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-medium text-white shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_8px_20px_rgba(34,211,238,0.15)] transition-all duration-150 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_12px_28px_rgba(34,211,238,0.25)] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
			>
				登录后台
			</button>
		</form>
	);
}
