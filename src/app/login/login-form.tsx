import { t, type Locale } from "@/lib/i18n/translations";
import { Input, Notice } from "@/components/ui-primitives";
import { SubmitButton } from "@/components/submit-button";
import { TURNSTILE_SCRIPT_URL } from "@/lib/auth/turnstile";

type LoginFormProps = {
	nextPath: string;
	error?: string;
	locale: Locale;
	/** Cloudflare Turnstile's site key when the login asks for human verification. */
	turnstileSiteKey?: string;
	/** The page's CSP nonce, for Turnstile's script. */
	nonce?: string;
};



export function LoginForm({ nextPath, error, locale, turnstileSiteKey, nonce }: LoginFormProps) {
	return (
		<form action="/api/login" method="post" className="space-y-4">
			<input type="hidden" name="next" value={nextPath} />

			<div className="space-y-1.5">
				<label className="ui-label" htmlFor="username">
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
				<label className="ui-label" htmlFor="password">
					{t("login.form.password", locale)}
				</label>
				<Input id="password"
					name="password"
					type="password"
					placeholder={t("login.form.passwordPlaceholder", locale)}
					autoComplete="current-password"
					 />
			</div>

			<label data-tile className="flex items-center gap-3 px-4 py-3 text-xs font-medium text-[var(--text-primary)] light:bg-[var(--surface)]">
				<input
					type="checkbox"
					name="remember"
					className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
				/>
				<span>{t("login.form.remember", locale)}</span>
			</label>

			{turnstileSiteKey ? (
				<div className="space-y-1.5">
					<span className="ui-label">{t("login.form.captcha", locale)}</span>
					{/* The widget adds the cf-turnstile-response field to this form. */}
					<div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="auto" data-size="flexible" data-language={locale === "zh" ? "zh-cn" : "en"} data-testid="login-turnstile" />
					<script src={TURNSTILE_SCRIPT_URL} async defer nonce={nonce} />
				</div>
			) : null}

			{error ? (
				<Notice tone="danger" className="mb-4">{error}</Notice>
			) : null}

			<SubmitButton pendingLabel={t("login.form.submitting", locale)} className="w-full py-2.5 text-sm font-semibold">
					{t("login.form.submit", locale)}
				</SubmitButton>
		</form>
	);
}
