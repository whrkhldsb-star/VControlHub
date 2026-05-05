"use client";

import Link from "next/link";
import { logError } from "@/lib/logging";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
 useEffect(() => {
 logError("[ErrorBoundary]", error);
 }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4">⚠</div>
        <h1 className="text-2xl font-semibold text-white">页面出错了</h1>
        <p className="mt-3 text-sm text-slate-400">
          {error.message || "发生了意外错误，请稍后重试。"}
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-slate-600">错误标识：{error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-6 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
          >
            重试
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
