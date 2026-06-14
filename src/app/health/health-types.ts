/**
 * Shared types for the health dashboard. Extracted from
 * `health-dashboard-client.tsx` so the client and the new `useHealthData`
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
	diskMax?: number;
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
};

export type SystemHealthReport = {
	generatedAt: string;
	summary: SystemHealthSummary;
	checks: SystemHealthCheck[];
};
