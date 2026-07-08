

import { getDirectGatewayRiskAssessment } from "@/lib/server/direct-gateway";

export type DirectGatewayInput = {
  
  directGateway: {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
    
    bindAddress?: string | null;
    
    publicProtocol?: "http" | "https" | "unknown" | null;
  } | null | undefined;
  
  serverEnabled: boolean;
  
  hasStorageNode: boolean;
  
  pendingCommandCount: number;
  
  canManageServers: boolean;
};

export type DirectGatewayAdviceItem = {
  
  title: string;
  
  detail: string;
  
  priority: "primary" | "secondary";
  
  href: string | null;
  
  hrefLabel?: string;
  
  tone?: "emerald" | "amber" | "rose";
};


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
        
        
        const bindAddress = dg?.bindAddress ?? "127.0.0.1";
        const resolvedProtocol = dg?.publicProtocol ?? "unknown";
        const protocolForRisk =
          resolvedProtocol === "http" || resolvedProtocol === "https"
            ? resolvedProtocol
            : "http"; 
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
          
          result.push({
            title: t("directGatewayAdvice.transportDanger.title"),
            detail: t("directGatewayAdvice.transportDanger.detail")
              .replace("{reasons}", risk.reasons.join("; "))
              .replace("{recommendation}", risk.recommendations[0] ?? t("directGatewayAdvice.transportDanger.fallbackRecommendation")),
            priority: "primary",
            href: input.canManageServers ? "/servers" : null,
            hrefLabel: t("directGatewayAdvice.hrefLabel.nodeList"),
            tone: "rose",
          });
        }
        
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
