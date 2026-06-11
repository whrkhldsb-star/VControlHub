"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "./submit-button";
import { changePasswordAction, type AccountPasswordActionState } from "@/app/account/password/actions";

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

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center">
			<div
				className="absolute inset-0 bg-black/60 light:bg-slate-900/60 backdrop-blur-sm"
				onClick={onClose}
			/>

			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				className="relative z-10 w-full max-w-md mx-4 rounded-3xl border border-[var(--border)] bg-slate-900 light:bg-white p-6 shadow-2xl"
			>
				<div className="flex items-center justify-between mb-4">
					<h2 id={titleId} className="text-xl font-semibold text-white">修改登录密码</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-xl p-2 text-slate-400 light:text-slate-600 hover:bg-white/5 hover:text-white light:hover:text-slate-900 transition"
						aria-label="关闭修改密码弹窗"
					>
						<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				<p id={descriptionId} className="mb-4 text-sm text-slate-400 light:text-slate-600">
					输入当前密码后设置新密码。修改后不会强制退出，下次登录需使用新密码。
				</p>

				<form action={formAction} className="grid gap-4">
					<input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
					<PasswordField
						label="当前密码"
						name="currentPassword"
						autoComplete="current-password"
						description="请输入当前正在使用的登录密码。"
					/>
					<PasswordField
						label="新密码"
						name="newPassword"
						autoComplete="new-password"
						description="至少 8 位，建议混合大小写、数字和符号。"
					/>
					<PasswordField
						label="确认新密码"
						name="confirmPassword"
						autoComplete="new-password"
						description="再次输入新密码，避免输错。"
					/>

					{state.error ? (
						<div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 light:text-rose-900">{state.error}</div>
					) : null}
					{state.success ? (
						<div role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 light:text-emerald-900">{state.success}</div>
					) : null}

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-2xl border border-[var(--border)] px-5 py-2.5 text-sm text-slate-300 light:text-slate-700 hover:bg-white/5 transition"
						>
							取消
						</button>
						<SubmitButton pendingLabel="保存中...">保存新密码</SubmitButton>
					</div>
				</form>
			</div>
		</div>
	);
}

function PasswordField({ label, name, autoComplete, description }: PasswordFieldProps) {
	const inputId = useId();
	const descriptionId = useId();
	const [visible, setVisible] = useState(false);

	return (
		<div className="grid gap-2 text-sm text-slate-300 light:text-slate-700">
			<label htmlFor={inputId}>{label}</label>
			<div className="flex overflow-hidden rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white focus-within:border-cyan-400/60">
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
					aria-label={`${visible ? "隐藏" : "显示"}${label}`}
					aria-pressed={visible}
					onClick={() => setVisible((current) => !current)}
					className="border-l border-[var(--border)] px-4 text-xs font-medium text-cyan-200 light:text-cyan-800 transition hover:bg-white/5 hover:text-cyan-100 light:hover:text-cyan-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-400"
				>
					{visible ? "隐藏" : "显示"}
				</button>
			</div>
			<p id={descriptionId} className="text-[11px] text-slate-500">{description}</p>
		</div>
	);
}
