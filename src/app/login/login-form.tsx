import { t, type Locale } from "@/lib/i18n/translations";
import { Input, StateBox } from "@/components/ui-primitives";
import { SubmitButton } from "@/components/submit-button";

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

			<label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-xs font-medium text-[var(--text-primary)] shadow-sm light:bg-[var(--surface)]">
				<input
					type="checkbox"
					name="remember"
					className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
				/>
				<span>{t("login.form.remember", locale)}</span>
			</label>

			{error ? (
				<StateBox tone="danger" role="alert" className="mb-4">
					{error}
				</StateBox>
			) : null}

			<SubmitButton pendingLabel={t("login.form.submitting", locale)} className="w-full py-2.5 text-sm font-semibold">
					{t("login.form.submit", locale)}
				</SubmitButton>
		</form>
	);
}
