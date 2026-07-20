/**
 * Shared types for the health dashboard. Extracted from
 * `system-health-client.tsx` / `vps-status-client.tsx` so the split clients and `useHealthData`
 * hook can share them without circular imports.
 */

export type SystemHealthStatus = "healthy" | "warning" | "critical";

export type SystemHealthSummary = {
	total: number;
	healthy: number;
	warning: number;
	critical: number;
	overall: SystemHealthStatus;
};

export type ServerHealth = {
	serverId: string;
	serverName: string;
	host: string;
	enabled: boolean;
	status: "healthy" | "warning" | "critical" | "offline" | "unknown";
	cpu?: number;
	mem?: number;
	memUsedMb?: number;
	memTotalMb?: number;
	diskMax?: number;
	diskUsedLabel?: string;
	diskTotalLabel?: string;
	loadAvg1m?: number;
	networkInKbps?: number;
	networkOutKbps?: number;
	networkRxBytes?: number;
	networkTxBytes?: number;
	monthlyRxBytes?: number;
	monthlyTxBytes?: number;
	swapUsagePercent?: number;
	uptime?: string;
	lastCheck: string;
	error?: string;
};

export type HealthOverview = {
	total: number;
	online: number;
	warning: number;
	critical: number;
	offline: number;
	servers: ServerHealth[];
};

export type MetricPoint = {
	cpu: number;
	mem: number;
	disk: number;
	online: boolean;
	t: string;
};

export type SystemHealthCheck = {
	id: string;
	label: string;
	status: SystemHealthStatus;
	message: string;
	detail?: string;
	params?: Record<string, string | number>;
	messageCode?: string;
};

export type SystemHealthReport = {
	generatedAt: string;
	summary: SystemHealthSummary;
	checks: SystemHealthCheck[];
};
