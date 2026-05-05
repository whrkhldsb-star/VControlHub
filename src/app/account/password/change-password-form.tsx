"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { changePasswordAction, type AccountPasswordActionState } from "./actions";

const initialState: AccountPasswordActionState = {};

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">修改登录密码</h2>
        <p className="mt-2 text-sm text-slate-400">
          输入当前密码后设置新密码。修改后不会强制退出，但下次登录需使用新密码。
        </p>
      </div>

      <div className="grid gap-4">
        <label className="grid gap-2 text-sm text-slate-300">
          <span>当前密码</span>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
            placeholder="请输入当前密码"
          />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          <span>新密码</span>
          <input
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
            placeholder="至少 8 位"
          />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          <span>确认新密码</span>
          <input
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
            placeholder="再次输入新密码"
          />
        </label>
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{state.error}</div>
      ) : null}
      {state.success ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{state.success}</div>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="保存中...">保存新密码</SubmitButton>
      </div>
    </form>
  );
}
