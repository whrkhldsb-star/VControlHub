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
            aria-label={`打开 ${serverName} SSH 终端`}
            data-tone="cyan" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:border-cyan-700/30 light:bg-cyan-50 light:hover:bg-cyan-100"
          >
            <span aria-hidden="true">💻</span>
            <span>SSH 终端</span>
          </button>
        )}

        {canManageServers && directGateway ? (
          <form
            action={directAction}
            aria-label="目标服务器直连网关控制"
            data-tone="cyan" className="space-y-3 rounded-2xl border border-cyan-400/20 p-3 light:border-cyan-700/20 light:bg-cyan-50/80"
          >
            <input type="hidden" name="serverId" value={serverId} />
            <input
              type="hidden"
              name="enabledDirectGateway"
              value={directGateway.enabled ? "false" : "true"}
            />
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="text-xs font-medium text-slate-200">
                直连状态：{directGateway.statusLabel}
              </div>
              {directGateway.publicUrl ? (
                <a
                  href={directGateway.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-xs font-medium text-cyan-100 underline decoration-cyan-300/50 underline-offset-2 hover:text-white light:hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:hover:text-cyan-950"
                >
                  {directGateway.publicUrl}
                </a>
              ) : (
                <div className="text-[11px] text-slate-500">
                  当前上传、下载、在线浏览默认走网站中转。
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3 text-[11px] leading-5 text-slate-400 light:border-cyan-700/15">
              {directGateway.enabled ? (
                <>
                  <p className="font-medium text-cyan-100">
                    直连服务已声明启用。
                  </p>
                  <p>
                    若文件预览/下载异常，请先确认目标 VPS 上 Direct Gateway
                    进程仍在监听 {directGateway.port || "配置端口"}，并检查防火墙是否放行该端口；切回网站中转会先尝试卸载远端服务，成功后再更新数据库状态。
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-cyan-100">
                    启用前检查：VPS 必须绑定 SFTP 存储节点且不是本机地址。
                  </p>
                  <p>
                    点击启用会通过 SSH 安装目标服务器 Direct Gateway；如果远端安装失败，页面会保留网站中转并显示错误，不会把直连标记成成功。
                  </p>
                </>
              )}
            </div>
            <SubmitButton
              pendingLabel={
                directGateway.enabled ? "删除服务中..." : "安装服务中..."
              }
              data-tone="cyan" className="w-full rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:border-cyan-700/30 light:bg-cyan-100 light:hover:bg-cyan-200"
            >
              {directGateway.enabled
                ? "切回网站中转并删除直连服务"
                : "启用目标直连"}
            </SubmitButton>
            {directState.error ? (
              <div role="alert" className="text-xs text-rose-200">
                {directState.error}
              </div>
            ) : null}
            {directState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {directState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <button
            type="button"
            onClick={() => setShowEdit((value) => !value)}
            className="w-full rounded-2xl border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
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
              data-tone="emerald" className="w-full rounded-2xl border border-emerald-400/30 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 light:border-emerald-700/30 light:bg-emerald-50 light:hover:bg-emerald-100"
            >
              保存并校验连接
            </SubmitButton>
            {editState.error ? (
              <div role="alert" className="text-xs text-rose-200">{editState.error}</div>
            ) : null}
            {editState.success ? (
              <div role="status" className="text-xs text-emerald-200">
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
              data-tone="cyan" className="w-full rounded-2xl border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 light:border-cyan-700/30 light:bg-cyan-50 light:hover:bg-cyan-100"
            >
              {enabled ? "停用节点" : "启用节点"}
            </SubmitButton>
            {toggleState.error ? (
              <div role="alert" className="text-xs text-rose-200">{toggleState.error}</div>
            ) : null}
            {toggleState.success ? (
              <div role="status" className="text-xs text-emerald-200">
                {toggleState.success}
              </div>
            ) : null}
          </form>
        ) : null}

        {canManageServers ? (
          <form action={deleteAction} className="space-y-2">
            <input type="hidden" name="serverId" value={serverId} />
            {isConfirming ? (
              <div
                role="alertdialog"
                aria-modal="false"
                aria-labelledby={`delete-server-title-${serverId}`}
                aria-describedby={`delete-server-description-${serverId}`}
                data-tone="rose" className="space-y-3 rounded-2xl border border-rose-400/30 p-3 light:bg-rose-50/80"
              >
                <input type="hidden" name="confirmDelete" value="true" />
                <div className="space-y-1 text-sm text-rose-200">
                  <p id={`delete-server-title-${serverId}`} className="font-semibold">
                    确认删除「{serverName}」？
                  </p>
                  <div id={`delete-server-description-${serverId}`}>
                  {relatedStorageCount > 0 ? (
                    <p className="mt-1 text-xs text-rose-300/80">
                      该 VPS 关联了 {relatedStorageCount}{" "}
                      个存储节点，删除后存储节点将失去 VPS 绑定
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-rose-300/80">
                    删除成功后节点会从 VPS 列表移除，并同步清理关联存储/直连状态；请输入节点名称完成确认。
                  </p>
                  </div>
                </div>
                <label
                  htmlFor={`delete-confirm-name-${serverId}`}
                  className="block text-xs font-medium text-rose-200"
                >
                  输入 VPS 名称「{serverName}」确认删除
                </label>
                <input
                  id={`delete-confirm-name-${serverId}`}
                  name="confirmName"
                  type="text"
                  autoComplete="off"
                  className="w-full rounded-lg border border-rose-400/30 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 light:placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
                />
                <div className="flex gap-2">
                  <SubmitButton
                    pendingLabel="删除中..."
                    data-tone="rose" className="flex-1 rounded-2xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 light:hover:bg-rose-100 light:hover:bg-rose-200"
                  >
                    确认删除
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={() => router.refresh()}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 light:hover:bg-slate-100"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <SubmitButton
                pendingLabel="查询中..."
                data-tone="rose" className="w-full rounded-2xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 light:hover:bg-rose-50 light:hover:bg-rose-100"
              >
                删除节点
              </SubmitButton>
            )}
            {deleteState.error ? (
              <div role="alert" className="text-xs text-rose-200">{deleteState.error}</div>
            ) : null}
            {deleteState.success ? (
              <div role="status" className="text-xs text-emerald-200">
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
