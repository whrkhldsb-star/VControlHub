"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import { changePasswordAction, type AccountPasswordActionState } from "./actions";

const initialState: AccountPasswordActionState = {};
const POST_SUCCESS_REDIRECT_DELAY_MS = 1500;

export function ChangePasswordForm() {
	const { t } = useI18n();
	const [state, formAction] = useActionState(changePasswordAction, initialState);
	const router = useRouter();
	const searchParams = useSearchParams();
	const [countdown, setCountdown] = useState<number | null>(null);

	// TR-052: 改密成功后自动跳到 dashboard (默认 "/", 尊重 ?next=). 给用户 1.5s 看 success message 再跳.
	useEffect(() => {
		if (!state.success) return;
		const nextPath = searchParams.get("next");
		const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
		// eslint-disable-next-line react-hooks/set-state-in-effect -- success → 启动 countdown + 1.5s 后的 setTimeout 跳转; 业务上需要 setState-in-effect 来同步启动客户端计时器
		setCountdown(POST_SUCCESS_REDIRECT_DELAY_MS / 1000);
		const interval = setInterval(() => {
			setCountdown((current) => (current === null ? null : Math.max(0, current - 1)));
		}, 1000);
		const timer = setTimeout(() => {
			clearInterval(interval);
			router.push(safeNext);
		}, POST_SUCCESS_REDIRECT_DELAY_MS);
		return () => {
			clearTimeout(timer);
			clearInterval(interval);
		};
	}, [state.success, router, searchParams]);

	return (
		<form action={formAction} className="grid gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
			<input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
			<div>
				<h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("common.editPassword")}</h2>
				<p className="mt-2 text-sm text-[var(--text-secondary)]">
					{t("accountPasswordPage.formDescription")}
				</p>
			</div>

			<div className="grid gap-4">
				<PasswordField
					label={t("accountPasswordPage.fields.currentLabel")}
					name="currentPassword"
					autoComplete="current-password"
					placeholder={t("accountPasswordPage.fields.currentPlaceholder")}
				/>
				<PasswordField
					label={t("accountPasswordPage.fields.newLabel")}
					name="newPassword"
					autoComplete="new-password"
					placeholder={t("accountPasswordPage.fields.newPlaceholder")}
				/>
				<PasswordField
					label={t("accountPasswordPage.fields.confirmLabel")}
					name="confirmPassword"
					autoComplete="new-password"
					placeholder={t("accountPasswordPage.fields.confirmPlaceholder")}
				/>
			</div>

			{state.error ? (
				<div data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">{state.error}</div>
			) : null}
			{state.success ? (
				<div data-tone="emerald" className="rounded-2xl border border-[var(--success-border)] px-4 py-3 text-sm text-[var(--success)]" role="status" aria-live="polite">
					{state.success}
					{countdown !== null && countdown > 0 ? (
						<span className="ml-2 text-[var(--success)]0/80">
							{t("accountPasswordPage.redirectCountdown").replace("{seconds}", String(countdown))}
						</span>
					) : null}
				</div>
			) : null}

			<div className="flex items-center justify-end gap-3">
				{state.success ? (
					<button
						type="button"
						onClick={() => {
							const nextPath = searchParams.get("next");
							const safeNext = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
							router.push(safeNext);
						}}
						className="rounded-2xl border border-[var(--color-action-border)]/40 px-4 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--color-action)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-action-ring)]"
					>
						{t("accountPasswordPage.redirectNow")}
					</button>
				) : null}
				<SubmitButton pendingLabel={t("accountPasswordPage.saving")}>{t("common.saveNewPassword")}</SubmitButton>
			</div>
		</form>
	);
}

type PasswordFieldProps = {
  label: string;
  name: "currentPassword" | "newPassword" | "confirmPassword";
  autoComplete: "current-password" | "new-password";
  placeholder: string;
};

function PasswordField({ label, name, autoComplete, placeholder }: PasswordFieldProps) {
  const { t } = useI18n();
  const inputId = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="grid gap-2 text-sm text-[var(--text-secondary)]">
      <label htmlFor={inputId}>{label}</label>
      <div className="flex overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] focus-within:border-[var(--color-action-border)]/60">
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[var(--text-primary)] outline-none"
          placeholder={placeholder}
        />
        <button
          type="button"
          aria-label={`${visible ? t("accountPasswordPage.toggle.hide") : t("accountPasswordPage.toggle.show")}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="border-l border-[var(--border)] px-4 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)] light:hover:text-[var(--color-action-strong)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-action-ring)]"
        >
          {visible ? t("accountPasswordPage.toggle.hide") : t("accountPasswordPage.toggle.show")}
        </button>
      </div>
    </div>
  );
}
