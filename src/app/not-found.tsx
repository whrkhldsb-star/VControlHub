import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 light:bg-white px-6">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-3xl font-semibold text-white">404</h1>
        <p className="mt-3 text-[var(--text-secondary)]">页面不存在或已被移除</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full border border-cyan-400/30 bg-cyan-400/10 px-6 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
        >
          ← 返回首页
        </Link>
      </div>
    </main>
  );
}
