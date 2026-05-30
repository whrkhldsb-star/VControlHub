"use client";

import { useState } from "react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createServerAction, type ServerActionState } from "./actions";

const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};

/**
 * 连接方式 + 凭证字段 — 完全自包含子组件
 * 自行管理 connectionType state，不受外层 useActionState 重渲染影响
 */
function ConnectionTypeFields({
  sshKeys,
}: {
  sshKeys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    description: string | null;
  }>;
}) {
  const [connectionType, setConnectionType] = useState<"SSH_KEY" | "PASSWORD">(
    "SSH_KEY",
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-white/50 tracking-wide">
          连接方式
        </label>
        <div className="flex gap-2">
          {(["SSH_KEY", "PASSWORD"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setConnectionType(type)}
              className={`flex-1 rounded-lg border px-3.5 py-2 text-sm transition ${
                connectionType === type
                  ? "border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100 font-medium"
                  : "border-white/[0.06] bg-white/[0.03] text-slate-400 hover:bg-white/[0.05]"
              }`}
            >
              {type === "SSH_KEY" ? "SSH 密钥" : "密码"}
            </button>
          ))}
        </div>
        <input type="hidden" name="connectionType" value={connectionType} />
      </div>

      {connectionType === "SSH_KEY" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-white/50 tracking-wide"
              htmlFor="sshKeyId"
            >
              SSH 密钥
            </label>
            <select
              id="sshKeyId"
              name="sshKeyId"
              required
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/30 focus:bg-white/[0.06]"
            >
              <option value="">选择密钥</option>
              {sshKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-white/50 tracking-wide"
              htmlFor="serverUsername"
            >
              用户名
            </label>
            <input
              key="ssh-key-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-white/50 tracking-wide"
              htmlFor="serverUsername"
            >
              用户名
            </label>
            <input
              key="password-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-white/50 tracking-wide"
              htmlFor="serverPassword"
            >
              密码
            </label>
            <input
              key="password-secret"
              id="serverPassword"
              name="password"
              type="password"
              defaultValue=""
              autoComplete="new-password"
              placeholder="留空，不使用默认密码"
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
            />
            <p className="text-[11px] text-slate-500">
              密码不会预填；请手动输入目标 VPS 当前 SSH 密码。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ServerCreateForm({
  sshKeys,
}: {
  sshKeys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    description: string | null;
  }>;
}) {
  const [state, formAction] = useActionState(createServerAction, initialState);

  return (
    <form
      action={formAction}
      className="grid gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
    >
      <div>
        <h2 className="text-lg font-semibold text-white">添加 VPS 节点</h2>
        <p className="mt-1 text-xs text-slate-500">
          录入 SSH 密钥、IP 与端口完成纳管
        </p>
      </div>

      {state.error && (
        <div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-400/20 px-3.5 py-2.5 text-sm text-emerald-200">
          {state.success}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-white/50 tracking-wide"
            htmlFor="serverName"
          >
            节点名称
          </label>
          <input
            id="serverName"
            name="name"
            type="text"
            required
            placeholder="例如 prod-1"
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
          />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-white/50 tracking-wide"
            htmlFor="serverDesc"
          >
            描述
          </label>
          <input
            id="serverDesc"
            name="description"
            type="text"
            placeholder="可选"
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-white/50 tracking-wide"
            htmlFor="serverHost"
          >
            IP / 主机名
          </label>
          <input
            id="serverHost"
            name="host"
            type="text"
            required
            placeholder="1.2.3.4"
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
          />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-white/50 tracking-wide"
            htmlFor="serverPort"
          >
            端口
          </label>
          <input
            id="serverPort"
            name="port"
            type="number"
            defaultValue={22}
            min={1}
            max={65535}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/30 focus:bg-white/[0.06]"
          />
        </div>
      </div>

      <ConnectionTypeFields sshKeys={sshKeys} />

      <div className="space-y-1.5">
        <label
          className="text-xs font-medium text-white/50 tracking-wide"
          htmlFor="serverStoragePath"
        >
          存储路径
        </label>
        <input
          id="serverStoragePath"
          name="storagePath"
          type="text"
          defaultValue="/root/drive"
          placeholder="/root/drive"
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
        />
        <p className="mt-1 text-xs text-slate-500">
          VPS 上的文件存储目录，用于云盘和媒体库。默认{" "}
          <code className="text-cyan-300/70">/root/drive</code>，可按需修改。
        </p>
      </div>

      <label className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 text-sm text-slate-200">
        <div className="flex items-start gap-3">
          <input
            name="enableDirectGateway"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-cyan-400/40 bg-slate-950"
          />
          <div>
            <div className="font-medium text-cyan-100">启用目标服务器直连</div>
            <p className="mt-1 text-xs text-slate-400">
              默认使用网站服务器中转；勾选后会通过 SSH 安装 VControlHub Direct
              Gateway 微服务。
            </p>
            <p className="mt-1 text-xs text-slate-500">
              启用后对上传、下载、在线浏览/播放全局生效；之后也可在服务器管理面板切回中转并删除服务。
            </p>
          </div>
        </div>
      </label>

      <div className="space-y-1.5">
        <label
          className="text-xs font-medium text-white/50 tracking-wide"
          htmlFor="serverTags"
        >
          标签
        </label>
        <input
          id="serverTags"
          name="tags"
          type="text"
          placeholder="逗号分隔，例如 prod,web"
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]"
        />
      </div>

      <SubmitButton pendingLabel="添加中…">添加节点</SubmitButton>
    </form>
  );
}
