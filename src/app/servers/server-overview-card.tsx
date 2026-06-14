"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ServerCardActions } from "./server-card-actions";
import { getDirectGatewayHealthyNote, getDirectGatewayRepairAdvice } from "./direct-gateway-advice";

type DiagnosticRunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; summary: string; checkedAt: string }
  | { status: "error"; message: string; checkedAt: string };

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
    storageNode?: { id: string; name: string; basePath: string } | null;
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
  const [diagnosticRun, setDiagnosticRun] = useState<DiagnosticRunState>({ status: "idle" });
  const directLabel = server.directGateway?.statusLabel ?? "网站中转";
  const detailsId = `server-details-${server.id}`;

  // Status badge reflects the latest live probe outcome instead of the static
  // "启用 · 待探测" placeholder. This is what the user expects after clicking
  // "运行实时探测" — they want to see the chip change to 在线/离线/检测中.
  let listHealthLabel: string;
  let listHealthToneClass: string;
  let listHealthDescription: string;
  if (!server.enabled) {
    listHealthLabel = "停用";
    listHealthToneClass =
      "border-slate-400/20 bg-slate-400/10 text-slate-400";
    listHealthDescription =
      "节点已停用，不会接收新的 SSH、文件或直连操作。";
  } else if (diagnosticRun.status === "loading") {
    listHealthLabel = "检测中";
    listHealthToneClass =
      "border-sky-400/30 bg-sky-400/10 text-sky-200 light:border-sky-700/30 light:bg-sky-50";
    listHealthDescription = "正在通过 /api/servers/monitor 实时探测，请稍候。";
  } else if (diagnosticRun.status === "success") {
    listHealthLabel = `在线 · ${diagnosticRun.checkedAt.split(" ").pop() ?? ""}`.trim();
    listHealthToneClass =
      "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 light:border-emerald-700/30 light:bg-emerald-50";
    listHealthDescription =
      diagnosticRun.summary
        ? `最近一次实时探测成功：${diagnosticRun.summary}（${diagnosticRun.checkedAt}）`
        : `最近一次实时探测成功（${diagnosticRun.checkedAt}）`;
  } else if (diagnosticRun.status === "error") {
    listHealthLabel = "离线";
    listHealthToneClass =
      "border-rose-400/30 bg-rose-400/10 text-rose-200 light:border-rose-700/30 light:bg-rose-50";
    listHealthDescription = `最近一次实时探测失败：${diagnosticRun.message}（${diagnosticRun.checkedAt}）`;
  } else {
    listHealthLabel = "启用 · 待探测";
    listHealthToneClass =
      "border-amber-400/20 bg-amber-400/10 text-amber-100 light:border-amber-700/25 light:bg-amber-50";
    listHealthDescription =
      "该节点已允许接收操作，但列表状态未代表 SSH/SFTP/直连实时在线；展开详情可运行实时探测。";
  }
  const directGatewayAdvice = getDirectGatewayRepairAdvice({
    directGateway: server.directGateway ?? null,
    serverEnabled: server.enabled,
    hasStorageNode: !!server.storageNode,
    pendingCommandCount: server.pendingCommandCount,
    canManageServers,
  });
  const directGatewayHealthy = directGatewayAdvice.length === 0;
  const diagnosticItems: Array<{
    label: string;
    status: string;
    tone: "success" | "warning" | "info";
    detail: ReactNode;
    href: string | null;
  }> = [
    {
      label: "SSH 交互连接",
      status: server.enabled && canUseSshTerminal ? "可验证" : server.enabled ? "缺少权限" : "节点停用",
      tone: server.enabled && canUseSshTerminal ? "success" : "warning",
      detail: server.enabled
        ? "从详情操作区打开 SSH 终端，确认凭据、网络和远端 shell 是否真实可用。"
        : "先启用节点后再进行实时连接诊断。",
      href: null,
    },
    {
      label: "SFTP / 文件管理",
      status: server.storageNode ? "已绑定" : "未绑定",
      tone: server.storageNode ? "success" : "warning",
      detail: server.storageNode
        ? `文件入口将使用 ${server.storageNode.name} · ${server.storageNode.basePath}。`
        : "未绑定存储节点时，文件浏览、媒体索引和直连文件代理都缺少真实目录边界。",
      href: server.storageNode ? `/files?nodeId=${encodeURIComponent(server.storageNode.id)}` : null,
    },
    {
      label: "Direct Gateway",
      status: server.directGateway?.enabled ? "已配置" : "网站中转",
      tone: server.directGateway?.enabled ? "success" : "info",
      detail: directGatewayHealthy ? (
        <DirectGatewayHealthyDetail
          statusLabel={server.directGateway?.statusLabel ?? "网站中转"}
          publicUrl={server.directGateway?.publicUrl ?? null}
        />
      ) : (
        <DirectGatewayAdviceList advice={directGatewayAdvice} />
      ),
      href: server.directGateway?.publicUrl ?? null,
    },
    {
      label: "命令审批队列",
      status: server.pendingCommandCount > 0 ? `${server.pendingCommandCount} 条待处理` : "无待审批",
      tone: server.pendingCommandCount > 0 ? "warning" : "success",
      detail: server.pendingCommandCount > 0
        ? "先处理审批中心里的待审批命令，避免诊断结果被排队任务遮蔽。"
        : "没有待审批命令阻塞当前节点操作。",
      href: server.pendingCommandCount > 0 ? "/requests" : null,
    },
  ];

  const runRealtimeDiagnostics = async () => {
    setDiagnosticRun({ status: "loading" });
    try {
      const response = await fetch(`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      const checkedAt = new Date().toLocaleString("zh-CN", { hour12: false });

      if (!response.ok) {
        setDiagnosticRun({
          status: "error",
          message: payload?.error ?? `监控接口返回 ${response.status}`,
          checkedAt,
        });
        return;
      }
      if (payload?.error) {
        setDiagnosticRun({ status: "error", message: payload.error, checkedAt });
        return;
      }

      const diskText = Array.isArray(payload?.disk) && payload.disk.length > 0
        ? `，磁盘 ${payload.disk[0].mount} ${payload.disk[0].usagePercent}%`
        : "";
      setDiagnosticRun({
        status: "success",
        summary: `CPU ${payload?.cpu?.usagePercent ?? "--"}% · 内存 ${payload?.memory?.usagePercent ?? "--"}%${diskText}`,
        checkedAt,
      });
    } catch (error) {
      setDiagnosticRun({
        status: "error",
        message: error instanceof Error ? error.message : "实时探测失败",
        checkedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      });
    }
  };

  return (
    <article data-card className="bg-white/[0.025] p-3 transition-colors hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? "bg-emerald-400" : "bg-slate-500"}`}
              aria-hidden="true"
            />
            <h2 className="truncate text-sm font-semibold text-white">
              {server.name}
            </h2>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {server.username}@{server.host}:{server.port}
          </p>
        </div>
        <span
          role="status"
          aria-label={`节点实时状态：${listHealthLabel}`}
          title={listHealthDescription}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${listHealthToneClass}`}
        >
          {listHealthLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
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
      <p className="mt-2 rounded-lg border border-amber-400/10 bg-amber-400/[0.04] px-2 py-1.5 text-[11px] leading-5 text-slate-500 light:border-amber-700/15 light:bg-amber-50">
        {listHealthDescription}
      </p>

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
          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 light:hover:bg-slate-100"
        >
          {expanded ? "收起详情" : "查看详情"}
        </button>
      </div>

      {expanded ? (
        <div
          id={detailsId}
          role="region"
          aria-label={`${server.name} VPS 详情`}
          className="mt-4 space-y-3 border-t border-white/[0.06] pt-4"
        >
          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
            <h3 className="mb-3 text-sm font-medium text-white/80">
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
            <p className="mt-3 rounded-lg border border-cyan-400/10 bg-cyan-400/5 p-2 text-[11px] leading-5 text-slate-500 light:border-cyan-700/15 light:bg-cyan-50">
              状态徽章表示 VControlHub 是否允许该 VPS 接收操作；若 SSH
              终端、文件中转或直连访问异常，请结合下方连接摘要、直连模式和最近命令状态定位真实服务健康。
            </p>
            {server.sshKey?.fingerprint ? (
              <p className="mt-2 truncate text-[11px] text-slate-600">
                指纹：{server.sshKey.fingerprint}
              </p>
            ) : null}
            {(server.tags ?? []).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(server.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
            <h3 className="mb-3 text-sm font-medium text-white/80">
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

          <section className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.035] p-3 light:border-cyan-700/15 light:bg-cyan-50">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-medium text-cyan-100">
                  诊断下一步
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  这里展示的是可执行诊断入口：节点“启用”只表示允许接收操作，不等于 SSH、SFTP 或 Direct Gateway 实时在线。
                </p>
              </div>
              <Link
                href={`/api/servers/monitor?serverId=${encodeURIComponent(server.id)}`}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-300/15 light:border-cyan-700/20"
              >
                查看实时监控 JSON
              </Link>
            </div>
            <div className="mt-3 rounded-lg border border-white/[0.05] bg-slate-950/35 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-medium text-white">实时探测</div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    点击后通过现有监控接口发起一次 SSH 只读采样，失败时会显示连接、权限或远端命令错误。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runRealtimeDiagnostics}
                  disabled={diagnosticRun.status === "loading" || !server.enabled}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60 light:border-emerald-700/20 light:bg-emerald-50"
                >
                  {diagnosticRun.status === "loading" ? "探测中..." : "运行实时探测"}
                </button>
              </div>
              {diagnosticRun.status === "success" ? (
                <div role="status" data-tone="emerald" className="mt-3 rounded-lg border border-emerald-400/20 p-2 text-[11px] leading-5 text-emerald-100 light:border-emerald-700/20 light:bg-emerald-50">
                  探测成功：{diagnosticRun.summary}（{diagnosticRun.checkedAt}）
                </div>
              ) : null}
              {diagnosticRun.status === "error" ? (
                <div role="alert" data-tone="rose" className="mt-3 rounded-lg border border-rose-400/20 p-2 text-[11px] leading-5 text-rose-100 light:border-rose-700/20 light:bg-rose-50">
                  探测失败：{diagnosticRun.message}（{diagnosticRun.checkedAt}）
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {diagnosticItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-white/[0.05] bg-slate-950/35 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-white">
                      {item.label}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusToneClass(item.tone)}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-slate-500">
                    {item.detail}
                  </div>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="mt-2 inline-flex text-[11px] font-medium text-cyan-200 underline-offset-4 hover:underline"
                    >
                      打开相关入口
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-3">
            <h3 className="mb-3 text-sm font-medium text-white/80">
              最近命令投递
            </h3>
            {server.latestCommands.length === 0 ? (
              <p className="text-xs text-slate-500">
                暂无命令投递记录。
              </p>
            ) : (
              <div className="space-y-2">
                {server.latestCommands.map((command) => (
                  <div
                    key={command.id}
                    className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {command.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {command.initiatedByType === "ASSISTANT"
                          ? "助手"
                          : "用户"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
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
    <div className="min-w-0 rounded-lg border border-white/[0.04] bg-slate-950/30 px-2 py-1.5">
      <div className="text-[10px] text-slate-600">{label}</div>
      <div className="truncate text-[11px] text-slate-200">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-[88px] shrink-0 text-xs text-slate-500">{label}</span>
      <span className="truncate text-sm text-white">{value}</span>
    </div>
  );
}

function statusToneClass(tone: "success" | "warning" | "info") {
  if (tone === "success") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 light:border-emerald-700/20 light:bg-emerald-50";
  }
  if (tone === "warning") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200 light:border-amber-700/20 light:bg-amber-50";
  }
  return "border-sky-400/25 bg-sky-400/10 text-sky-200 light:border-sky-700/20 light:bg-sky-50";
}

type AdviceListProps = {
  advice: Array<{
    title: string;
    detail: string;
    priority: "primary" | "secondary";
    href: string | null;
    hrefLabel?: string;
  }>;
};

function DirectGatewayAdviceList({ advice }: AdviceListProps) {
  if (advice.length === 0) return null;
  return (
    <ul
      role="list"
      aria-label="Direct Gateway 修复建议"
      className="mt-1 space-y-1.5"
    >
      {advice.map((item, index) => (
        <li
          key={`${item.title}-${index}`}
          className="rounded-md border border-amber-400/15 bg-amber-400/[0.05] px-2 py-1.5 light:border-amber-700/20 light:bg-amber-50/60"
        >
          <div className="flex flex-wrap items-baseline gap-1.5 text-[11px] font-medium leading-5 text-amber-100 light:text-amber-900">
            <span
              data-priority={item.priority}
              className={
                item.priority === "primary"
                  ? "rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200 light:border-amber-700/25 light:text-amber-800"
                  : "rounded border border-slate-300/20 bg-slate-300/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 light:border-slate-400/30"
              }
            >
              {item.priority === "primary" ? "建议" : "参考"}
            </span>
            <span>{item.title}</span>
            {item.href && item.hrefLabel ? (
              <Link
                href={item.href}
                className="ml-auto text-cyan-200 underline-offset-4 hover:underline light:text-cyan-700"
                aria-label={item.hrefLabel}
              >
                {item.hrefLabel}
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            {item.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DirectGatewayHealthyDetail({ statusLabel, publicUrl }: { statusLabel: string; publicUrl: string | null }) {
  return (
    <p data-testid="direct-gateway-healthy-note">{getDirectGatewayHealthyNote({ statusLabel, publicUrl })}</p>
  );
}
