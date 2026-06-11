"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { changePasswordAction, type AccountPasswordActionState } from "./actions";

const initialState: AccountPasswordActionState = {};

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-[var(--border)] bg-slate-900/60 light:bg-white/60 p-6">
      <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
      <div>
        <h2 className="text-xl font-semibold text-white">修改登录密码</h2>
        <p className="mt-2 text-sm text-slate-400 light:text-slate-600">
          输入当前密码后设置新密码。修改后不会强制退出，但下次登录需使用新密码。
        </p>
      </div>

      <div className="grid gap-4">
        <PasswordField
          label="当前密码"
          name="currentPassword"
          autoComplete="current-password"
          placeholder="请输入当前密码"
        />
        <PasswordField
          label="新密码"
          name="newPassword"
          autoComplete="new-password"
          placeholder="至少 8 位"
        />
        <PasswordField
          label="确认新密码"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="再次输入新密码"
        />
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 light:text-rose-900">{state.error}</div>
      ) : null}
      {state.success ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 light:text-emerald-900">{state.success}</div>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="保存中...">保存新密码</SubmitButton>
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
  const inputId = useId();
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
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-white outline-none"
          placeholder={placeholder}
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
    </div>
  );
}
