import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { exportFileSchema } from "../config-schema";

/**
 * Every column of an exported model is either in the package or deliberately
 * left out here. Columns added later used to vanish from migrations silently
 * (a Windows node came back as Linux, a WebDAV node without its endpoint):
 * a new column now fails this test until someone decides which side it is on.
 */
const NOT_EXPORTED: Record<string, { model: Record<string, string>; skip: string[] }> = {
	servers: {
		model: Prisma.ServerScalarFieldEnum,
		// Agent identity and runtime state (the Agent is reinstalled), onboarding
		// and gateway state (re-derived on the target: its per-server key comes
		// from the target's own secret, so the gateway is enabled again there),
		// bookkeeping.
		skip: ["agentTokenHash", "agentLastSeenAt", "agentMetricsAt", "agentMetricsRaw", "agentVersion", "agentCapabilities", "agentLastError",
			"onboardingStatus", "onboardingLastError", "directGatewayDesiredEnabled", "directGatewayDesiredProtocol", "directGatewayDesiredDomain",
			"directGatewayKeyVersion", "costLastSyncedAt", "addedById", "updatedAt"],
	},
	storageNodes: { model: Prisma.StorageNodeScalarFieldEnum, skip: ["lastHealthCheckAt", "lastHealthError", "lastHealthLatencyMs", "updatedAt"] },
	sshKeys: { model: Prisma.SshKeyScalarFieldEnum, skip: ["updatedAt"] },
	// The session epoch and selected customer belong to the instance's sessions.
	users: { model: Prisma.UserScalarFieldEnum, skip: ["sessionEpoch", "currentTeamId", "updatedAt"] },
	// Deleted customers are not exported.
	teams: { model: Prisma.TeamScalarFieldEnum, skip: ["createdAt", "updatedAt"] },
	identityTemplates: { model: Prisma.IdentityTemplateScalarFieldEnum, skip: ["createdBy", "createdAt", "updatedAt"] },
	teamMembers: { model: Prisma.TeamMemberScalarFieldEnum, skip: [] },
	userServerAccess: { model: Prisma.UserServerAccessScalarFieldEnum, skip: [] },
	userStorageAccess: { model: Prisma.UserStorageAccessScalarFieldEnum, skip: ["updatedAt"] },
	commandTemplates: { model: Prisma.CommandTemplateScalarFieldEnum, skip: ["updatedAt"] },
	// The container belongs to the source host; the service is redeployed.
	quickServices: { model: Prisma.QuickServiceScalarFieldEnum, skip: ["containerId", "error", "createdBy", "updatedAt"] },
	// Scheduling and match state are recomputed (cron playbooks get nextRunAt from the trigger worker).
	playbooks: { model: Prisma.PlaybookScalarFieldEnum, skip: ["nextRunAt", "lastTriggeredAt", "metricMatchState", "updatedAt"] },
	alertRules: { model: Prisma.AlertRuleScalarFieldEnum, skip: ["lastMatchedAt", "matchState", "lastTriggeredAt", "updatedAt"] },
	aiProviders: { model: Prisma.AiProviderScalarFieldEnum, skip: ["updatedAt"] },
	announcements: { model: Prisma.AnnouncementScalarFieldEnum, skip: ["updatedAt"] },
	snippets: { model: Prisma.SnippetScalarFieldEnum, skip: ["updatedAt"] },
	roles: { model: Prisma.RoleScalarFieldEnum, skip: ["createdAt", "updatedAt"] },
	permissions: { model: Prisma.PermissionScalarFieldEnum, skip: [] },
};

function exportedFields(table: string): Set<string> {
	let schema = (exportFileSchema.shape.tables.shape as Record<string, ZodType>)[table] as unknown as {
		element?: { shape: Record<string, unknown> };
		unwrap?: () => unknown;
		_def?: { innerType?: unknown };
	};
	while (schema && !schema.element) {
		schema = (schema.unwrap ? schema.unwrap() : schema._def?.innerType) as typeof schema;
	}
	return new Set(Object.keys(schema.element!.shape));
}

describe("config export field coverage", () => {
	it.each(Object.keys(NOT_EXPORTED))("%s: every column is exported or deliberately skipped", (table) => {
		const { model, skip } = NOT_EXPORTED[table]!;
		const exported = exportedFields(table);
		const unclassified = Object.keys(model).filter((field) => !exported.has(field) && !skip.includes(field));
		expect(unclassified).toEqual([]);
		// A skipped column that is exported after all, or no longer exists, is stale.
		expect(skip.filter((field) => exported.has(field) || !(field in model))).toEqual([]);
	});
});
