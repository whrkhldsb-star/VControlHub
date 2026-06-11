"use client";

import { useActionState } from "react";

import { SubmitButton } from "./submit-button";

import { changePasswordAction, type AccountPasswordActionState } from "@/app/account/password/actions";

const initialState: AccountPasswordActionState = {};

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [state, formAction] = useActionState(changePasswordAction, initialState);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/60 light:bg-slate-900/60 backdrop-blur-sm"
				onClick={onClose}
			/>

			{/* Modal */}
			<div className="relative z-10 w-full max-w-md mx-4 rounded-3xl border border-white/10 light:border-slate-200 bg-slate-900 light:bg-white p-6 shadow-2xl">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-xl font-semibold text-white">修改登录密码</h2>
					<button
						onClick={onClose}
						className="rounded-xl p-2 text-slate-400 light:text-slate-600 hover:bg-white/5 hover:text-white light:hover:text-slate-900 transition"
						aria-label="关闭"
					>
						<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				<p className="mb-4 text-sm text-slate-400 light:text-slate-600">
					输入当前密码后设置新密码。修改后不会强制退出，下次登录需使用新密码。
				</p>

				<form action={formAction} className="grid gap-4">
					<label className="grid gap-2 text-sm text-slate-300 light:text-slate-700">
						<span>当前密码</span>
						<input
							name="currentPassword"
							type="password"
							required
							autoComplete="current-password"
							className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-3 text-white focus:outline-none focus:border-cyan-400/50"
							placeholder="请输入当前密码"
						/>
					</label>
					<label className="grid gap-2 text-sm text-slate-300 light:text-slate-700">
						<span>新密码</span>
						<input
							name="newPassword"
							type="password"
							required
							autoComplete="new-password"
							className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-3 text-white focus:outline-none focus:border-cyan-400/50"
							placeholder="至少 8 位"
						/>
					</label>
					<label className="grid gap-2 text-sm text-slate-300 light:text-slate-700">
						<span>确认新密码</span>
						<input
							name="confirmPassword"
							type="password"
							required
							autoComplete="new-password"
							className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-3 text-white focus:outline-none focus:border-cyan-400/50"
							placeholder="再次输入新密码"
						/>
					</label>

					{state.error ? (
						<div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 light:text-rose-900">{state.error}</div>
					) : null}
					{state.success ? (
						<div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 light:text-emerald-900">{state.success}</div>
					) : null}

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-2xl border border-white/10 light:border-slate-200 px-5 py-2.5 text-sm text-slate-300 light:text-slate-700 hover:bg-white/5 transition"
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
