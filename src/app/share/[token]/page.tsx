import Link from "next/link";

import { peekShareToken } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let share: Awaited<ReturnType<typeof peekShareToken>> | null = null;
  let errorMessage = "";

  try {
    share = await peekShareToken(token);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "分享链接无效";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 light:bg-white px-4 py-16 text-slate-100 light:text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-2xl">
            {errorMessage ? "🔒" : "📦"}
          </div>
          <h1 className="text-lg font-semibold text-white light:text-slate-900">
            {errorMessage ? "无法访问该分享" : "文件分享"}
          </h1>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-center text-sm text-rose-200 light:text-rose-800">
            {errorMessage}
          </div>
        ) : share ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="break-all text-base font-medium text-white light:text-slate-900">
                {share.name || share.path}
              </p>
              <dl className="mt-3 space-y-1.5 text-xs text-slate-400 light:text-slate-600">
                <div className="flex justify-between gap-3">
                  <dt>存储节点</dt>
                  <dd className="text-slate-300 light:text-slate-700">{share.storageNode?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>类型</dt>
                  <dd className="text-slate-300 light:text-slate-700">
                    {share.entryType === "DIRECTORY" ? "目录" : "文件"}
                  </dd>
                </div>
                {share.expiresAt ? (
                  <div className="flex justify-between gap-3">
                    <dt>有效期至</dt>
                    <dd className="text-slate-300 light:text-slate-700">
                      {new Date(share.expiresAt).toLocaleString("zh-CN")}
                    </dd>
                  </div>
                ) : (
                  <div className="flex justify-between gap-3">
                    <dt>有效期</dt>
                    <dd className="text-slate-300 light:text-slate-700">永久有效</dd>
                  </div>
                )}
              </dl>
            </div>

            {share.entryType === "DIRECTORY" ? (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-center text-xs text-amber-200 light:text-amber-800">
                该分享指向一个目录，暂不支持在线打包下载。请联系分享者获取具体文件。
              </div>
            ) : (
              <a
                href={`/api/share/${encodeURIComponent(token)}`}
                className="block rounded-lg bg-cyan-600 px-4 py-3 text-center text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500"
              >
                ⬇ 下载文件
              </a>
            )}
          </div>
        ) : null}

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-slate-500 transition hover:text-slate-300 light:hover:text-slate-700">
            VControlHub
          </Link>
        </div>
      </div>
    </main>
  );
}
