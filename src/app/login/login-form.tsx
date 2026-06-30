import { t, type Locale } from "@/lib/i18n/translations";

type LoginFormProps = {
	nextPath: string;
	error?: string;
	locale: Locale;
};

const fieldClassName =
	"w-full rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.05)] outline-none transition-colors duration-150 placeholder:text-white/20 focus:border-cyan-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-cyan-400/10 light:border-slate-300 light:bg-slate-50 light:text-slate-900 light:placeholder:text-[var(--text-muted)] light:focus:border-cyan-500/70 light:focus:bg-white light:focus:ring-cyan-500/10";

export function LoginForm({ nextPath, error, locale }: LoginFormProps) {
	return (
		<form action="/api/login" method="post" className="space-y-4">
			<input type="hidden" name="next" value={nextPath} />

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-[var(--text-primary)]" htmlFor="username">
					{t("login.form.username", locale)}
				</label>
				<input
					id="username"
					name="username"
					type="text"
					placeholder={t("login.form.usernamePlaceholder", locale)}
					autoComplete="username"
					className={fieldClassName}
				/>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-[var(--text-primary)]" htmlFor="password">
					{t("login.form.password", locale)}
				</label>
				<input
					id="password"
					name="password"
					type="password"
					placeholder={t("login.form.passwordPlaceholder", locale)}
					autoComplete="current-password"
					className={fieldClassName}
				/>
			</div>

			<label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.025] px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.03)] light:border-slate-200/80 light:shadow-sm">
				<span>{t("login.form.remember", locale)}</span>
				<input
					type="checkbox"
					name="remember"
					className="h-4 w-4 rounded-lg border-[var(--border)] bg-white/[0.06] text-cyan-400 focus:ring-cyan-400/40 light:focus:ring-cyan-500/30"
				/>
			</label>

			{error ? (
				<div role="alert" data-tone="rose" className="rounded-2xl border border-rose-400/15 px-4 py-2.5 text-sm font-medium text-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.08)] light:border-rose-200 light:bg-rose-50 light:shadow-sm">
					{error}
				</div>
			) : null}

			<button
				type="submit"
				className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_8px_20px_rgba(34,211,238,0.15)] transition-[filter,box-shadow] duration-150 hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_12px_28px_rgba(34,211,238,0.25)] focus:outline-none focus:ring-4 focus:ring-cyan-400/40 light:from-cyan-500 light:to-blue-600 light:shadow-[0_12px_28px_rgba(14,116,144,0.22)] light:hover:shadow-[0_16px_34px_rgba(14,116,144,0.28)] light:focus:ring-cyan-500/20"
			>
				{t("login.form.submit", locale)}
			</button>
		</form>
	);
}
