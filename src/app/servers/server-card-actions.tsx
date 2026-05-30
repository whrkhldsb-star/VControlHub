"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { SshTerminalModal } from "@/components/ssh-terminal-modal";

import {
  deleteServerAction,
  toggleDirectGatewayAction,
  toggleServerAction,
  updateServerAction,
  type ServerActionState,
} from "./actions";

const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};

type ServerCardActionsProps = {
  serverId: string;
  serverName: string;
  host: string;
  port: number;
  enabled: boolean;
  sessionToken: string;
  username?: string;
  connectionType?: "SSH_KEY" | "PASSWORD";
  description?: string | null;
  tags?: string[] | null;
  canManageServers?: boolean;
  canUseSshTerminal?: boolean;
  onSshConnect?: () => void;
  directGateway?: {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
  };
};

export function ServerCardActions({
  serverId,
  serverName,
  host,
  port,
  enabled,
  sessionToken,
  username = "root",
  connectionType = "PASSWORD",
  description = "",
  tags = [],
  canManageServers = true,
  canUseSshTerminal = false,
  onSshConnect,
  directGateway,
}: ServerCardActionsProps) {
  const router = useRouter();
  const [toggleState, toggleAction] = useActionState(
    toggleServerAction,
    initialState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteServerAction,
    initialState,
  );
  const [directState, directAction] = useActionState(
    toggleDirectGatewayAction,
    initialState,
  );
  const [editState, editAction] = useActionState(
    updateServerAction,
    initialState,
  );
  const [showTerminal, setShowTerminal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const isConfirming =
    deleteState.relatedStorageCount !== undefined &&
    !deleteState.success &&
    !deleteState.error;
  const relatedStorageCount = deleteState.relatedStorageCount ?? 0;

  const handleOpenTerminal = () => {
    onSshConnect?.();
    setShowTerminal(true);
  };

  return (
    <>
      <div className="space-y-3">
        {/* SSH Terminal button */}
        {enabled && canUseSshTerminal && (
          <button
            type="button"
            onClick={handleOpenTerminal}
            className="w-full rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 flex items-center justify-center gap-2"
          >
            <span>💻</span>
            <span>SSH 终端</span>
          </button>
        )}

        {canManageServers && directGateway ? (
          <form
            action={directAction}
            className="space-y-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-3"
          >
            <input type="hidden" name="serverId" value={serverId} />
            <input
              type="hidden"
              name="enabledDirectGateway"
              value={directGateway.enabled ? "false" : "true"}
            />
            <div className="text-xs text-slate-300">
              直连状态：{directGateway.statusLabel}
            </div>
            {directGateway.publicUrl ? (
              <div className="break-all text-[11px] text-slate-500">
                {directGateway.publicUrl}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                当前上传、下载、在线浏览默认走网站中转。
              </div>
            )}
            <SubmitButton
              pendingLabel={
                directGateway.enabled ? "删除服务中..." : "安装服务中..."
              }
              className="w-full rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
            >
              {directGateway.enabled
                ? "切回网站中转并删除直连服务"
                : "启用目标直连"}
            </SubmitButton>
            {directState.error ? (
              <div className="text-xs text-rose-200">{directState.error}</div>
            ) : null}
            {directState.success ? (
              <div className="text-xs text-emerald-200">
                {directState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <button
            type="button"
            onClick={() => setShowEdit((value) => !value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          >
            {showEdit ? "收起编辑" : "编辑节点"}
          </button>
        ) : null}

        {canManageServers && showEdit ? (
          <form
            action={editAction}
            aria-label="编辑 VPS 节点"
            className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <input type="hidden" name="serverId" value={serverId} />
            <input type="hidden" name="connectionType" value={connectionType} />
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-name-${serverId}`}
            >
              节点名称
            </label>
            <input
              id={`edit-name-${serverId}`}
              name="name"
              type="text"
              defaultValue={serverName}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-host-${serverId}`}
            >
              IP / 域名
            </label>
            <input
              id={`edit-host-${serverId}`}
              name="host"
              type="text"
              defaultValue={host}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-port-${serverId}`}
            >
              SSH 端口
            </label>
            <input
              id={`edit-port-${serverId}`}
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={port}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-username-${serverId}`}
            >
              用户名
            </label>
            <input
              id={`edit-username-${serverId}`}
              name="username"
              type="text"
              defaultValue={username}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            {connectionType === "PASSWORD" ? (
              <>
                <label
                  className="block text-xs text-slate-400"
                  htmlFor={`edit-password-${serverId}`}
                >
                  新密码（留空保持不变）
                </label>
                <input
                  id={`edit-password-${serverId}`}
                  name="password"
                  type="password"
                  defaultValue=""
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                />
              </>
            ) : null}
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-description-${serverId}`}
            >
              描述
            </label>
            <textarea
              id={`edit-description-${serverId}`}
              name="description"
              defaultValue={description ?? ""}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <label
              className="block text-xs text-slate-400"
              htmlFor={`edit-tags-${serverId}`}
            >
              标签
            </label>
            <input
              id={`edit-tags-${serverId}`}
              name="tags"
              type="text"
              defaultValue={(tags ?? []).join(",")}
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
            <SubmitButton
              pendingLabel="校验中..."
              className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20"
            >
              保存并校验连接
            </SubmitButton>
            {editState.error ? (
              <div className="text-xs text-rose-200">{editState.error}</div>
            ) : null}
            {editState.success ? (
              <div className="text-xs text-emerald-200">
                {editState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <form action={toggleAction} className="space-y-2">
            <input type="hidden" name="serverId" value={serverId} />
            <SubmitButton
              pendingLabel="处理中..."
              className="w-full rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
            >
              {enabled ? "停用节点" : "启用节点"}
            </SubmitButton>
            {toggleState.error ? (
              <div className="text-xs text-rose-200">{toggleState.error}</div>
            ) : null}
            {toggleState.success ? (
              <div className="text-xs text-emerald-200">
                {toggleState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <form action={deleteAction} className="space-y-2">
            <input type="hidden" name="serverId" value={serverId} />
            {isConfirming ? (
              <>
                <input type="hidden" name="confirmDelete" value="true" />
                <div className="rounded-2xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
                  确认删除「{serverName}」？
                  {relatedStorageCount > 0 ? (
                    <p className="mt-1 text-xs text-rose-300/80">
                      该 VPS 关联了 {relatedStorageCount}{" "}
                      个存储节点，删除后存储节点将失去 VPS 绑定
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <SubmitButton
                    pendingLabel="删除中..."
                    className="flex-1 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
                  >
                    确认删除
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={() => router.refresh()}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <SubmitButton
                pendingLabel="查询中..."
                className="w-full rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
              >
                删除节点
              </SubmitButton>
            )}
            {deleteState.error ? (
              <div className="text-xs text-rose-200">{deleteState.error}</div>
            ) : null}
            {deleteState.success ? (
              <div className="text-xs text-emerald-200">
                {deleteState.success}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
      {showTerminal ? (
        <SshTerminalModal
          serverId={serverId}
          serverName={serverName}
          host={`${host}:${port}`}
          sessionToken={sessionToken}
          onClose={() => setShowTerminal(false)}
        />
      ) : null}
    </>
  );
}
