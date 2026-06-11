import Link from "next/link";

import { listShareDirectoryFiles, peekShareToken } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

function formatSize(bytes: bigint | number | null) {
  if (bytes == null) return "未知";
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let share: Awaited<ReturnType<typeof peekShareToken>> | null = null;
  let files: Awaited<ReturnType<typeof listShareDirectoryFiles>> = [];
  let errorMessage = "";

  try {
    share = await peekShareToken(token);
    if (share.entryType === "DIRECTORY") {
      files = await listShareDirectoryFiles(share);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "分享链接无效";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 light:bg-white px-4 py-16 text-slate-100">
      <div className="w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl light:border-slate-200 light:bg-white">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-2xl">
            {errorMessage ? "🔒" : share?.entryType === "DIRECTORY" ? "📁" : "📦"}
          </div>
          <h1 className="text-lg font-semibold text-white">
            {errorMessage ? "无法访问该分享" : share?.entryType === "DIRECTORY" ? "目录分享" : "文件分享"}
          </h1>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-center text-sm text-rose-200 light:text-rose-800">
            {errorMessage}
          </div>
        ) : share ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 light:border-slate-200 light:bg-slate-50">
              <p className="break-all text-base font-medium text-white">
                {share.name || share.path}
              </p>
              <dl className="mt-3 grid gap-1.5 text-xs text-slate-400 light:text-slate-600 sm:grid-cols-2">
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
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt>路径</dt>
                  <dd className="break-all text-right text-slate-300 light:text-slate-700">{share.path}</dd>
                </div>
                {share.expiresAt ? (
                  <div className="flex justify-between gap-3 sm:col-span-2">
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
              <div data-card className=" p-4 light:border-slate-200 light:bg-slate-50">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white">可下载文件</h2>
                    <span className="text-xs text-slate-500">最多显示 200 个已索引文件</span>
                  </div>
                  <a
                    href={`/api/share/${encodeURIComponent(token)}?archive=1`}
                    className="shrink-0 rounded-lg border border-cyan-400/40 px-3 py-1.5 text-center text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 light:text-cyan-700"
                  >
                    ⬇ 下载整个目录
                  </a>
                </div>
                {files.length === 0 ? (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-center text-xs text-amber-200 light:text-amber-800">
                    当前目录暂未发现可下载文件。系统已自动尝试刷新目录索引，请稍后重试或联系分享者确认目录内有文件。
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] light:divide-slate-200">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{file.name}</div>
                          <div className="truncate text-xs text-slate-500" title={file.relativePath}>{file.relativePath} · {formatSize(file.size)}</div>
                        </div>
                        <a
                          href={`/api/share/${encodeURIComponent(token)}?path=${encodeURIComponent(file.relativePath)}`}
                          className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500"
                        >
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <a
                href={`/api/share/${encodeURIComponent(token)}`}
                className="block rounded-lg bg-cyan-600 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-cyan-500"
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
