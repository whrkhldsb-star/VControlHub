import { t, type Locale } from "@/lib/i18n/translations";
import { Input, StateBox } from "@/components/ui-primitives";

type LoginFormProps = {
	nextPath: string;
	error?: string;
	locale: Locale;
};



export function LoginForm({ nextPath, error, locale }: LoginFormProps) {
	return (
		<form action="/api/login" method="post" className="space-y-4">
			<input type="hidden" name="next" value={nextPath} />

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-[var(--text-primary)]" htmlFor="username">
					{t("login.form.username", locale)}
				</label>
				<Input id="username"
					name="username"
					type="text"
					placeholder={t("login.form.usernamePlaceholder", locale)}
					autoComplete="username"
					 />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-semibold tracking-wide text-[var(--text-primary)]" htmlFor="password">
					{t("login.form.password", locale)}
				</label>
				<Input id="password"
					name="password"
					type="password"
					placeholder={t("login.form.passwordPlaceholder", locale)}
					autoComplete="current-password"
					 />
			</div>

			<label className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.03)] light:border-slate-200/80 light:shadow-sm">
				<span>{t("login.form.remember", locale)}</span>
				<input
					type="checkbox"
					name="remember"
					className="h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--surface)]/[0.10] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]/40 light:focus:ring-[var(--color-action-ring)]/30"
				/>
			</label>

			{error ? (
				<StateBox tone="danger" role="alert" className="mb-4">
					{error}
				</StateBox>
			) : null}

			<button
				type="submit"
				data-variant="primary" className="w-full py-2.5 text-sm font-semibold"
			>
				{t("login.form.submit", locale)}
			</button>
		</form>
	);
}
