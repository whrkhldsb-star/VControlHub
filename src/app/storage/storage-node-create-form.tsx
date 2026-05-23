"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createStorageNodeAction, type StorageActionState } from "./actions";

const initialState: StorageActionState = {};

export function StorageNodeCreateForm({
  servers,
}: {
  servers: Array<{ id: string; name: string; host: string }>;
}) {
  const [state, formAction] = useActionState(createStorageNodeAction, initialState);
  const [driver, setDriver] = useState<string>("LOCAL");

  const isSftp = driver === "SFTP";

  return (
    <form action={formAction} className="grid gap-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
      <div>
        <h2 className="text-xl font-semibold text-white">新增存储节点</h2>
        <p className="mt-2 text-sm text-slate-400">支持本机存储与绑定 VPS 的 SFTP 存储节点。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-300">
          <span>节点名称</span>
          <input name="name" required className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          <span>驱动</span>
          <select
            name="driver"
            defaultValue="LOCAL"
            className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white"
            onChange={(e) => setDriver(e.target.value)}
          >
            <option value="LOCAL">LOCAL</option>
            <option value="SFTP">SFTP</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
          <span>根目录</span>
          <input name="basePath" required className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" placeholder="/srv/storage 或 /data/media" />
        </label>
        {isSftp ? (
          <>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>绑定 VPS <span className="text-rose-400">*（SFTP 必填绑定VPS或远端主机）</span></span>
              <select name="serverId" className="rounded-2xl border border-rose-400/40 bg-slate-950 px-4 py-3 text-white">
                <option value="">不绑定</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name} · {server.host}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>远端主机 <span className="text-rose-400">*（SFTP 必填远端主机或绑定VPS）</span></span>
              <input name="host" className="rounded-2xl border border-rose-400/40 bg-slate-950 px-4 py-3 text-white" placeholder="203.0.113.20" />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>端口</span>
              <input name="port" type="number" min={1} max={65535} defaultValue={22} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>用户名</span>
              <input name="username" defaultValue="root" className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" />
            </label>
            <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
              <span>访问模式</span>
              <select name="directAccessMode" defaultValue="PROXY" className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white">
                <option value="PROXY">网站服务器中转（最安全）</option>
                <option value="DIRECT">存储服务器直连（需签名外链服务）</option>
                <option value="AUTO">自动：可直连则直连，否则中转</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>直连基础 URL</span>
              <input name="publicBaseUrl" type="url" className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" placeholder="https://cdn.example.com/media" />
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              <span>直连链接有效期（秒）</span>
              <input name="directAccessExpiresSeconds" type="number" min={60} max={86400} defaultValue={300} className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white" />
            </label>
          </>
        ) : null}
        <label className="flex items-center gap-3 text-sm text-slate-300 md:col-span-2">
          <input name="isDefault" type="checkbox" className="h-4 w-4" />
          设为默认存储节点
        </label>
      </div>

      {state.error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{state.error}</div> : null}
      {state.success ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{state.success}</div> : null}

      <div className="flex justify-end"><SubmitButton pendingLabel="创建中...">创建节点</SubmitButton></div>
    </form>
  );
}
