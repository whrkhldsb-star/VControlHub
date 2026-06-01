"use client";

import { useState } from "react";

import { ServerCardActions } from "./server-card-actions";

type ServerOverviewCardProps = {
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    description?: string | null;
    tags?: string[] | null;
    enabled: boolean;
    connectionType: "SSH_KEY" | "PASSWORD";
    connectionSummary: string;
    connectionTypeLabel: string;
    statusLabel: string;
    pendingCommandCount: number;
    targetCount: number;
    latestCommands: Array<{
      id: string;
      title: string;
      initiatedByType: string;
      requestStatus: string;
      targetStatus: string;
    }>;
    sshKey: { name: string; fingerprint?: string | null } | null;
    storageNode?: { name: string; basePath: string } | null;
    directGateway?: {
      enabled: boolean;
      statusLabel: string;
      publicUrl: string | null;
      port: number;
    } | null;
  };
  sessionToken: string;
  canManageServers: boolean;
  canUseSshTerminal: boolean;
};

export function ServerOverviewCard({
  server,
  sessionToken,
  canManageServers,
  canUseSshTerminal,
}: ServerOverviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const directLabel = server.directGateway?.statusLabel ?? "网站中转";
  const detailsId = `server-details-${server.id}`;
  const managedStatusLabel = server.enabled ? "已启用" : "已停用";

  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 transition-colors hover:bg-white/[0.04] light:border-slate-200 light:bg-white light:shadow-sm light:hover:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? "bg-emerald-400" : "bg-slate-500"}`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold text-white light:text-slate-950">
              {server.name}
            </h2>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-500 light:text-slate-600">
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          aria-label={`节点状态：${managedStatusLabel}`}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${server.enabled ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 light:border-emerald-700/25 light:bg-emerald-50 light:text-emerald-800" : "border-slate-400/20 bg-slate-400/10 text-slate-400 light:border-slate-300 light:bg-slate-100 light:text-slate-700"}`}
        >
          {server.enabled ? "启用" : "停用"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400 light:text-slate-700">
        <CompactField label="连接" value={server.connectionTypeLabel} />
        <CompactField
          label="密钥"
          value={server.sshKey ? server.sshKey.name : "未配置"}
        />
        <CompactField label="直连" value={directLabel} />
        <CompactField
          label="待审批"
          value={`${server.pendingCommandCount} 条`}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {server.enabled && canUseSshTerminal ? (
          <ServerCardActions
            serverId={server.id}
            serverName={server.name}
            host={server.host}
            port={server.port}
            username={server.username}
            connectionType={server.connectionType as "SSH_KEY" | "PASSWORD"}
            description={server.description ?? null}
            tags={server.tags ?? []}
            enabled={server.enabled}
            sessionToken={sessionToken}
            canManageServers={false}
            canUseSshTerminal={canUseSshTerminal}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:border-slate-300 light:bg-white light:text-slate-800 light:hover:bg-slate-100"
        >
          {expanded ? "收起详情" : "查看详情"}
        </button>
      </div>

      {expanded ? (
        <div
          id={detailsId}
          role="region"
          aria-label={`${server.name} VPS 详情`}
          className="mt-4 space-y-3 border-t border-white/[0.06] pt-4 light:border-slate-200"
        >
          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3 light:border-slate-200 light:bg-slate-50">
            <h3 className="mb-3 text-sm font-medium text-white/80 light:text-slate-900">
              连接与状态
            </h3>
            <div className="grid gap-2 text-sm">
              <InfoRow label="连接方式" value={server.connectionTypeLabel} />
              <InfoRow label="登录账号" value={server.username} />
              <InfoRow label="地址" value={`${server.host}:${server.port}`} />
              <InfoRow label="节点状态" value={server.statusLabel} />
              <InfoRow
                label="SSH 密钥"
                value={server.sshKey ? server.sshKey.name : "未配置"}
              />
            </div>
            <p className="mt-3 rounded-lg border border-cyan-400/10 bg-cyan-400/5 p-2 text-[11px] leading-5 text-slate-500 light:border-cyan-700/15 light:bg-cyan-50 light:text-slate-700">
              状态徽章表示 VControlHub 是否允许该 VPS 接收操作；若 SSH
              终端、文件中转或直连访问异常，请结合下方连接摘要、直连模式和最近命令状态定位真实服务健康。
            </p>
            {server.sshKey?.fingerprint ? (
              <p className="mt-2 truncate text-[11px] text-slate-600 light:text-slate-500">
                指纹：{server.sshKey.fingerprint}
              </p>
            ) : null}
            {(server.tags ?? []).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(server.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400 light:border-slate-200 light:bg-white light:text-slate-700"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3 light:border-slate-200 light:bg-slate-50">
            <h3 className="mb-3 text-sm font-medium text-white/80 light:text-slate-900">
              操作与资源
            </h3>
            <div className="space-y-2 text-sm">
              <InfoRow
                label="关联存储"
                value={
                  server.storageNode
                    ? `${server.storageNode.name} · ${server.storageNode.basePath}`
                    : "未绑定"
                }
              />
              <InfoRow label="直连模式" value={directLabel} />
              <InfoRow
                label="累计命令目标"
                value={String(server.targetCount)}
              />
              <InfoRow label="连接摘要" value={server.connectionSummary} />
            </div>
            {canManageServers || canUseSshTerminal ? (
              <div className="mt-3">
                <ServerCardActions
                  serverId={server.id}
                  serverName={server.name}
                  host={server.host}
                  port={server.port}
                  enabled={server.enabled}
                  sessionToken={sessionToken}
                  canManageServers={canManageServers}
                  canUseSshTerminal={canUseSshTerminal}
                  username={server.username}
                  connectionType={server.connectionType}
                  description={server.description}
                  tags={server.tags}
                  directGateway={server.directGateway ?? undefined}
                />
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3 light:border-slate-200 light:bg-slate-50">
            <h3 className="mb-3 text-sm font-medium text-white/80 light:text-slate-900">
              最近命令投递
            </h3>
            {server.latestCommands.length === 0 ? (
              <p className="text-xs text-slate-500 light:text-slate-600">
                暂无命令投递记录。
              </p>
            ) : (
              <div className="space-y-2">
                {server.latestCommands.map((command) => (
                  <div
                    key={command.id}
                    className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 light:border-slate-200 light:bg-white"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-white light:text-slate-900">
                        {command.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500 light:text-slate-600">
                        {command.initiatedByType === "ASSISTANT"
                          ? "助手"
                          : "用户"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 light:text-slate-600">
                      {command.requestStatus} · {command.targetStatus}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </article>
  );
}

function CompactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.04] bg-slate-950/30 px-2 py-1.5 light:border-slate-200 light:bg-slate-50">
      <div className="text-[10px] text-slate-600 light:text-slate-500">{label}</div>
      <div className="truncate text-[11px] text-slate-200 light:text-slate-800">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-[88px] shrink-0 text-xs text-slate-500 light:text-slate-600">{label}</span>
      <span className="truncate text-sm text-white light:text-slate-900">{value}</span>
    </div>
  );
}
