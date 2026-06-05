import { requireSession } from "@/lib/auth/require-session";

import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPasswordPage() {
  await requireSession("/account/password");

  return (
    <main className="min-h-screen bg-slate-950 light:bg-white text-slate-100 light:text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
 <header className="mb-8">
 <h1 className="text-3xl font-semibold tracking-tight">修改密码</h1>
 <p className="mt-2 text-sm text-slate-400 light:text-slate-600">修改当前账号的后台登录密码</p>
 </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <ChangePasswordForm />

          <aside className="rounded-3xl border border-white/10 light:border-slate-200 bg-slate-900/60 light:bg-white/60 p-6">
            <h2 className="text-xl font-semibold text-white light:text-slate-900">安全建议</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300 light:text-slate-700">
              <li>• 新密码建议使用 12 位以上，并混合大小写字母、数字与符号。</li>
              <li>• 修改成功后，现有会话不会立即失效；下次登录会使用新密码。</li>
              <li>• 若多人共用管理员账号，建议后续补独立用户与角色分配，而不是长期共用默认管理员。</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  );
}
