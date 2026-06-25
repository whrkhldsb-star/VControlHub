"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "./submit-button";
import { changePasswordAction, type AccountPasswordActionState } from "@/app/account/password/actions";
import { useI18n } from "@/lib/i18n/use-locale";

const initialState: AccountPasswordActionState = {};

type PasswordFieldProps = {
	label: string;
	name: "currentPassword" | "newPassword" | "confirmPassword";
	autoComplete: "current-password" | "new-password";
	description: string;
};

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [state, formAction] = useActionState(changePasswordAction, initialState);
	const titleId = useId();
	const descriptionId = useId();
	const { t } = useI18n();
	const closeModalLabel = t("common.closeChangePasswordModal") === "common.closeChangePasswordModal"
		? "关闭修改密码弹窗"
		: t("common.closeChangePasswordModal");
	const changePasswordDescription = t("common.changePasswordDescription") === "common.changePasswordDescription"
		? "输入当前密码后设置新密码。修改后不会强制退出，下次登录需使用新密码。"
		: t("common.changePasswordDescription");
	const titleText = t("common.editPassword") === "common.editPassword"
		? "修改登录密码"
		: t("common.editPassword");

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center">
			<div
				className="absolute inset-0 bg-black/60 backdrop-blur-sm"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				className="relative z-10 w-full max-w-md mx-4 rounded-3xl border border-[var(--border)] bg-slate-900 p-6 shadow-2xl"
			>
				<div className="flex items-center justify-between mb-4">
					<h2 id={titleId} className="text-xl font-semibold text-white">{titleText}</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-white/5 hover:text-white light:hover:text-slate-900 transition"
						aria-label={closeModalLabel}
					>
						<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				<p id={descriptionId} className="mb-4 text-sm text-[var(--text-secondary)]">
					{changePasswordDescription}
				</p>

				<form action={formAction} className="grid gap-4">
					<input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
					<PasswordField
						label={t("changePassword.currentPassword")}
						name="currentPassword"
						autoComplete="current-password"
						description={t("changePassword.currentPasswordDesc")}
					/>
					<PasswordField
						label={t("changePassword.newPassword")}
						name="newPassword"
						autoComplete="new-password"
						description={t("changePassword.newPasswordDesc")}
					/>
					<PasswordField
						label={t("changePassword.confirmPassword")}
						name="confirmPassword"
						autoComplete="new-password"
						description={t("changePassword.confirmPasswordDesc")}
					/>

					{state.error ? (
						<div role="alert" data-tone="rose" className="rounded-2xl border border-rose-400/30 px-4 py-3 text-sm text-rose-100">{state.error}</div>
					) : null}
					{state.success ? (
						<div role="status" data-tone="emerald" className="rounded-2xl border border-emerald-400/30 px-4 py-3 text-sm text-emerald-100">{state.success}</div>
					) : null}

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-2xl border border-[var(--border)] px-5 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-white/5 transition"
						>
							{t("common.cancel")}
						</button>
						<SubmitButton pendingLabel={t("changePassword.saving")}>{t("common.saveNewPassword")}</SubmitButton>
					</div>
				</form>
			</div>
		</div>
	);
}

function PasswordField({ label, name, autoComplete, description }: PasswordFieldProps) {
	const { t } = useI18n();
	const inputId = useId();
	const descriptionId = useId();
	const [visible, setVisible] = useState(false);

	return (
		<div className="grid gap-2 text-sm text-[var(--text-secondary)]">
			<label htmlFor={inputId}>{label}</label>
			<div className="flex overflow-hidden rounded-2xl border border-[var(--border)] bg-slate-950 focus-within:border-cyan-400/60">
				<input
					id={inputId}
					name={name}
					type={visible ? "text" : "password"}
					required
					autoComplete={autoComplete}
					aria-describedby={descriptionId}
					className="min-w-0 flex-1 bg-transparent px-4 py-3 text-white outline-none"
				/>
				<button
					type="button"
					aria-label={`${visible ? t("changePassword.hide") : t("changePassword.show")}${label}`}
					aria-pressed={visible}
					onClick={() => setVisible((current) => !current)}
					className="border-l border-[var(--border)] px-4 text-xs font-medium text-cyan-200 transition hover:bg-white/5 hover:text-cyan-100 light:hover:text-cyan-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-400"
				>
					{visible ? t("changePassword.hide") : t("changePassword.show")}
				</button>
			</div>
			<p id={descriptionId} className="text-[11px] text-slate-500">{description}</p>
		</div>
	);
}
