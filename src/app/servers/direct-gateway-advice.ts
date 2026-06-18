/**
 * Direct Gateway 修复建议模型
 *
 * 来源：TR-013 — VPS 运维控制台 Direct Gateway 一键修复建议。
 *
 * 范围限定：
 * - 仅基于 `/servers` 服务端已下发的直连状态 + 当前节点、存储、启用状态做诊断
 * - 不引入新的网络探测或 service 调用（避免越界进入 TR-002 Direct Gateway TLS/传输边界加固）
 * - 不修改 `@/lib/server/direct-gateway` helpers 的行为
 *
 * 输出：每条建议包含一句可直接展示的"下一步"提示 + 可选锚链接（/files?nodeId=...、
 *      /servers、/requests），UI 决定样式。
 *
 * TR-002 R3: 同步接收 `bindAddress` + `publicProtocol` 两个字段，以便在
 * 启用直连时调用 `getDirectGatewayRiskAssessment` 给出 3 级（safe/warning/danger）
 * banner。两个字段兼容可空——尚未配置直连的节点不会用到。
 */

import { getDirectGatewayRiskAssessment } from "@/lib/server/direct-gateway";

export type DirectGatewayInput = {
  /** 服务端下发的直连状态（已规整为 {enabled, statusLabel, publicUrl, port}） */
  directGateway: {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
    /** TR-002 R3: 节点侧的直连服务监听地址，默认 127.0.0.1 */
    bindAddress?: string | null;
    /** TR-002 R3: 解析自 publicUrl 的实际传输协议 */
    publicProtocol?: "http" | "https" | "unknown" | null;
  } | null | undefined;
  /** 节点是否启用（已纳入"接收操作"的白名单） */
  serverEnabled: boolean;
  /** 是否绑定 SFTP 存储节点；Direct Gateway 需要 SFTP 节点作 file proxy 边界 */
  hasStorageNode: boolean;
  /** 当前待审批命令数；用于避免把"修复建议"和"队列噪音"混在一起 */
  pendingCommandCount: number;
  /** 是否具备 server:write（管理 VPS 节点） */
  canManageServers: boolean;
};

export type DirectGatewayAdviceItem = {
  /** 短标题，1 行，≤ 14 字 */
  title: string;
  /** 详细解释或操作说明，1-2 行 */
  detail: string;
  /** 修复建议优先级：primary 表示"应优先做"，secondary 表示"可选补充" */
  priority: "primary" | "secondary";
  /** 锚链接目标（可空） */
  href: string | null;
  /** 链接可访问名称（可空时由 UI 隐藏链接） */
  hrefLabel?: string;
  /** TR-002 R3: 风险等级横幅专用标签。advice 项附上 level 后，UI 可以在同一个
   * 列表里用不同色彩（emerald=安全 / amber=警告 / rose=危险）区分渲染。 */
  tone?: "emerald" | "amber" | "rose";
};

/**
 * 推导 Direct Gateway 修复建议列表（最多 2 条 primary + 1 条 secondary）。
 *
 * 规则（按优先级，命中即返回）：
 *  1. 节点停用 → "启用节点" 是任何后续诊断的前置
 *  2. 已启用直连 + 没有存储节点 → 不可能在 Direct Gateway 上提供文件代理；先绑定 SFTP
 *  3. 已启用直连 + port ≤ 0 / publicUrl 缺失 → 直连状态自身不一致，先看安装结果
 *  4. 未启用直连 + 已绑定 SFTP + 节点启用 → "启用目标直连" 提升下载/媒体性能
 *  5. 未启用直连 + 没有 SFTP + 节点启用 → "先绑定 SFTP，再考虑直连"
 *  6. 待审批命令 > 0 → secondary：先处理审批中心，避免修复被命令流遮蔽
 *  7. 具备 server:write 但没有任何建议 → secondary：参考直连签名边界文档
 *  8. TR-002 R3：已启用直连 + bind/protocol 已知 → 插入一条 risk banner（按等级染色）
 */
export function getDirectGatewayRepairAdvice(
	t: (key: string) => string,
	input: DirectGatewayInput,
): DirectGatewayAdviceItem[] {
  const result: DirectGatewayAdviceItem[] = [];
  const dg = input.directGateway;
  const isDirect = !!dg?.enabled;

  if (!input.serverEnabled) {
    return [
      {
        title: t("directGatewayAdvice.nodeDisabled.title"),
        detail: t("directGatewayAdvice.nodeDisabled.detail"),
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
      },
    ];
  }

  if (isDirect) {
    if (!input.hasStorageNode) {
      result.push({
        title: t("directGatewayAdvice.missingSftp.title"),
        detail: t("directGatewayAdvice.missingSftp.detail"),
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
      });
    } else {
      const port = dg?.port ?? 0;
      const publicUrl = dg?.publicUrl ?? null;
      if (port <= 0 || !publicUrl) {
        result.push({
          title: t("directGatewayAdvice.inconsistent.title"),
          detail: t("directGatewayAdvice.inconsistent.detail"),
          priority: "primary",
          href: input.canManageServers ? "/servers" : null,
          hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
        });
      } else {
        // TR-002 R3: 直连已就位 + bind/protocol 已知 → 评估传输风险
        // 协议不可解析时降级为 warning（与 danger 区分），不阻塞其它 primary 项
        const bindAddress = dg?.bindAddress ?? "127.0.0.1";
        const resolvedProtocol = dg?.publicProtocol ?? "unknown";
        const protocolForRisk =
          resolvedProtocol === "http" || resolvedProtocol === "https"
            ? resolvedProtocol
            : "http"; // unknown → 保守按明文对待，避免低估风险
        const risk = getDirectGatewayRiskAssessment({
          bindAddress,
          publicProtocol: protocolForRisk,
        });
        if (risk.level === "safe") {
          result.push({
            title: t("directGatewayAdvice.transportSafe.title"),
            detail: t("directGatewayAdvice.transportSafe.detail").replace("{bind}", bindAddress),
            priority: "secondary",
            href: null,
            tone: "emerald",
          });
        } else if (risk.level === "warning") {
          result.push({
            title: t("directGatewayAdvice.transportWarning.title"),
            detail: t("directGatewayAdvice.transportWarning.detail")
              .replace("{reason}", risk.reasons[0] ?? "")
              .replace("{recommendation}", risk.recommendations[0] ?? ""),
            priority: "primary",
            href: input.canManageServers ? "/servers" : null,
            hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
            tone: "amber",
          });
        } else {
          // danger：多 reason / 多 recommendation 用分号拼成一句可读 detail
          result.push({
            title: t("directGatewayAdvice.transportDanger.title"),
            detail: t("directGatewayAdvice.transportDanger.detail")
              .replace("{reasons}", risk.reasons.join("；"))
              .replace("{recommendation}", risk.recommendations[0] ?? t("directGatewayAdvice.transportDanger.fallbackRecommendation")),
            priority: "primary",
            href: input.canManageServers ? "/servers" : null,
            hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
            tone: "rose",
          });
        }
        // protocol 解析失败时再补一条 secondary 提示用户自查
        if (resolvedProtocol === "unknown") {
          result.push({
            title: t("directGatewayAdvice.protocolUnknown.title"),
            detail: t("directGatewayAdvice.protocolUnknown.detail"),
            priority: "secondary",
            href: input.canManageServers ? "/servers" : null,
            hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
            tone: "amber",
          });
        }
      }
    }
  } else {
    if (input.hasStorageNode) {
      result.push({
        title: t("directGatewayAdvice.canEnable.title"),
        detail: t("directGatewayAdvice.canEnable.detail"),
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
      });
    } else {
      result.push({
        title: t("directGatewayAdvice.needSftpFirst.title"),
        detail: t("directGatewayAdvice.needSftpFirst.detail"),
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
      });
    }
  }

  if (input.pendingCommandCount > 0) {
    result.push({
      title: t("directGatewayAdvice.pending.title").replace("{count}", String(input.pendingCommandCount)),
      detail: t("directGatewayAdvice.pending.detail"),
      priority: "secondary",
      href: "/requests",
      hrefLabel: t("directGatewayAdvice.hrefLabel.approvalCenter"),
    });
  } else if (result.length === 0 && input.canManageServers) {
    result.push({
      title: t("directGatewayAdvice.boundaryDoc.title"),
      detail: t("directGatewayAdvice.boundaryDoc.detail"),
      priority: "secondary",
      href: null,
    });
  }

  return result;
}

/** 给 UI 用的"无问题"提示文案 */
export function getDirectGatewayHealthyNote(
	t: (key: string) => string,
	input: { statusLabel: string; publicUrl: string | null },
): string {
  if (input.publicUrl) {
    return t("directGatewayHealthyNote.withPublicUrl")
      .replace("{status}", input.statusLabel)
      .replace("{url}", input.publicUrl);
  }
  return t("directGatewayHealthyNote.relayFallback").replace("{status}", input.statusLabel);
}
