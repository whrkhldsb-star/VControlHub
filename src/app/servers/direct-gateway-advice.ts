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
 */

export type DirectGatewayInput = {
  /** 服务端下发的直连状态（已规整为 {enabled, statusLabel, publicUrl, port}） */
  directGateway: {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
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
 */
export function getDirectGatewayRepairAdvice(input: DirectGatewayInput): DirectGatewayAdviceItem[] {
  const result: DirectGatewayAdviceItem[] = [];
  const dg = input.directGateway;
  const isDirect = !!dg?.enabled;

  if (!input.serverEnabled) {
    return [
      {
        title: "节点未启用",
        detail: "Direct Gateway 安装、操作和实时探测都需要节点处于启用状态；先在节点卡片启用后再诊断。",
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: "去节点列表",
      },
    ];
  }

  if (isDirect) {
    if (!input.hasStorageNode) {
      result.push({
        title: "直连已启用但缺少 SFTP 节点",
        detail: "Direct Gateway 需要绑定 SFTP 存储节点作为文件代理边界，否则直连签名下载将回退到网站中转。",
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: "去节点列表",
      });
    } else {
      const port = dg?.port ?? 0;
      const publicUrl = dg?.publicUrl ?? null;
      if (port <= 0 || !publicUrl) {
        result.push({
          title: "直连状态不一致",
          detail: "已启用但缺少公网入口或端口；请在节点卡片“切回网站中转”后再重新启用，或重新运行节点诊断确认远端服务是否启动。",
          priority: "primary",
          href: input.canManageServers ? "/servers" : null,
          hrefLabel: "去节点列表",
        });
      }
    }
  } else {
    if (input.hasStorageNode) {
      result.push({
        title: "可启用目标直连",
        detail: "当前会回退到网站服务器中转；若 VPS 与本机之间网络可用，启用直连可绕开中转提升大文件下载/媒体播放性能。",
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: "去节点列表",
      });
    } else {
      result.push({
        title: "先绑定 SFTP 存储节点",
        detail: "Direct Gateway 需要 SFTP 节点作为 file proxy 边界；先在节点卡片绑定 SFTP 节点，再考虑启用直连。",
        priority: "primary",
        href: input.canManageServers ? "/servers" : null,
        hrefLabel: "去节点列表",
      });
    }
  }

  if (input.pendingCommandCount > 0) {
    result.push({
      title: `审批中心有 ${input.pendingCommandCount} 条待处理`,
      detail: "先处理待审批命令，避免修复建议被排队任务遮蔽。",
      priority: "secondary",
      href: "/requests",
      hrefLabel: "打开审批中心",
    });
  } else if (result.length === 0 && input.canManageServers) {
    result.push({
      title: "Direct Gateway 边界文档",
      detail: "当前直连状态正常；可在节点详情查看直连签名链接行为，并结合防火墙、VPN 或反代 TLS 进一步加固传输边界。",
      priority: "secondary",
      href: null,
    });
  }

  return result;
}

/** 给 UI 用的"无问题"提示文案 */
export function getDirectGatewayHealthyNote(input: { statusLabel: string; publicUrl: string | null }): string {
  if (input.publicUrl) {
    return `当前已配置为 ${input.statusLabel}，公网入口 ${input.publicUrl} 可被签名链接调用。`;
  }
  return `当前为 ${input.statusLabel}，文件下载和媒体播放会回退到网站服务器中转。`;
}
