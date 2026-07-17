/**
 * ITSM adapters + service unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectionStore = new Map<string, Record<string, unknown>>();
const eventStore = new Map<string, Record<string, unknown>>();
const ticketStore = new Map<string, Record<string, unknown>>();
let seq = 0;

function reset() {
	connectionStore.clear();
	eventStore.clear();
	ticketStore.clear();
	seq = 0;
}

vi.mock("@/lib/db", () => ({
	prisma: {
		itsmConnection: {
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				seq += 1;
				const row = {
					id: `conn_${seq}`,
					lastOutboundAt: null,
					lastInboundAt: null,
					lastError: null,
					teamId: null,
					createdAt: new Date("2026-07-01T00:00:00Z"),
					updatedAt: new Date("2026-07-01T00:00:00Z"),
					credentialsEnc: "",
					...data,
				};
				connectionStore.set(row.id as string, row);
				return row;
			}),
			findMany: vi.fn(async () => Array.from(connectionStore.values())),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => connectionStore.get(where.id) ?? null),
			findFirst: vi.fn(async ({ where }: { where: { id: string } }) => connectionStore.get(where.id) ?? null),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const prev = connectionStore.get(where.id);
				if (!prev) throw new Error("missing");
				const next = { ...prev, ...data, updatedAt: new Date("2026-07-02T00:00:00Z") };
				connectionStore.set(where.id, next);
				return next;
			}),
			deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
				const existed = connectionStore.delete(where.id);
				return { count: existed ? 1 : 0 };
			}),
		},
		itsmEvent: {
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				seq += 1;
				const row: Record<string, unknown> = {
					id: `evt_${seq}`,
					createdAt: new Date("2026-07-01T01:00:00Z"),
					payload: {},
					errorMessage: null,
					externalId: null,
					ticketId: null,
					connectionId: null,
					...data,
				};
				// simulate unique (connectionId, externalId)
				if (row.externalId) {
					for (const existing of eventStore.values()) {
						if (
							existing.connectionId === row.connectionId &&
							existing.externalId === row.externalId
						) {
							const err = new Error("Unique constraint failed") as Error & { code: string };
							err.code = "P2002";
							// Make instanceof check work via Prisma mock path — service catches PrismaClientKnownRequestError
							Object.setPrototypeOf(err, Object.getPrototypeOf(err));
							throw Object.assign(err, { name: "PrismaClientKnownRequestError" });
						}
					}
				}
				eventStore.set(row.id as string, row);
				return row;
			}),
			findMany: vi.fn(async ({ where }: { where?: { connectionId?: string; ticketId?: string } }) => {
				let rows = Array.from(eventStore.values());
				if (where?.connectionId) rows = rows.filter((r) => r.connectionId === where.connectionId);
				if (where?.ticketId) rows = rows.filter((r) => r.ticketId === where.ticketId);
				return rows;
			}),
			findFirst: vi.fn(async ({ where }: { where: { connectionId?: string | null; externalId?: string } }) => {
				return (
					Array.from(eventStore.values()).find(
						(r) =>
							r.connectionId === where.connectionId &&
							r.externalId === where.externalId,
					) ?? null
				);
			}),
		},
		ticket: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ticketStore.get(where.id) ?? null),
			findFirst: vi.fn(async ({ where }: { where: { id: string; OR?: Array<{ teamId: string | null }> } }) => {
				const row = ticketStore.get(where.id);
				if (!row) return null;
				if (where.OR) {
					const allowed = new Set(where.OR.map((c) => c.teamId));
					if (!allowed.has((row.teamId as string | null) ?? null)) return null;
				}
				return row;
			}),
		},
	},
}));

vi.mock("@/lib/crypto/service", () => ({
	encrypt: (s: string) => `enc:${s}`,
	decrypt: (s: string) => {
		if (!s.startsWith("enc:")) throw new Error("bad");
		return s.slice(4);
	},
	isEncrypted: (s: string) => s.startsWith("enc:"),
}));

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@/lib/ticket/service", () => ({
	createTicket: vi.fn(async (input: {
		title: string;
		description: string;
		createdBy: string;
		session?: { currentTeamId: string | null };
	}) => {
		seq += 1;
		const row = {
			id: `tk_${seq}`,
			title: input.title,
			description: input.description,
			status: "OPEN",
			priority: "NORMAL",
			category: null,
			createdBy: input.createdBy,
			teamId: input.session?.currentTeamId ?? null,
		};
		ticketStore.set(row.id, row);
		return row;
	}),
	updateTicketStatus: vi.fn(async ({ id, status }: { id: string; status: string }) => {
		const prev = ticketStore.get(id);
		if (!prev) throw new Error("missing ticket");
		const next = { ...prev, status };
		ticketStore.set(id, next);
		return next;
	}),
	addTicketComment: vi.fn(async ({ ticketId, body }: { ticketId: string; body: string }) => ({
		id: `c_${++seq}`,
		ticketId,
		body,
	})),
}));

vi.mock("@/lib/security/webhook-url", () => ({
	validateWebhookUrlSyntax: (value: string) => {
		if (!value.startsWith("https://")) return { ok: false as const, error: "Webhook URL must use https://" };
		return { ok: true as const, url: value };
	},
	fetchWebhookSafely: vi.fn(async () => ({
		ok: true as const,
		response: {
			ok: true,
			status: 200,
			text: async () => '{"ok":true}',
		},
	})),
}));

import { createHmac } from "node:crypto";

import { buildOutboundBody, normalizeInboundTicket, verifyInboundSignature } from "../adapters";
import {
	createItsmConnection,
	handleInboundWebhook,
	listItsmConnections,
	testItsmConnection,
} from "../service";

describe("ITSM adapters", () => {
	it("builds slack/generic outbound bodies", () => {
		const payload = {
			ticketId: "t1",
			title: "Disk full",
			description: "node-a disk > 90%",
			status: "OPEN",
			priority: "HIGH",
			eventType: "ticket.created",
		};
		const slack = buildOutboundBody("slack", payload, {});
		expect(JSON.parse(slack.body).text).toContain("Disk full");
		const generic = buildOutboundBody("generic_webhook", payload, { workspace: "ops" });
		const body = JSON.parse(generic.body);
		expect(body.source).toBe("vcontrolhub");
		expect(body.ticket.id).toBe("t1");
		expect(body.workspace).toBe("ops");
	});

	it("verifies HMAC signatures", () => {
		const secret = "s3cret";
		const raw = '{"hello":"world"}';
		const sig = createHmac("sha256", secret).update(raw).digest("hex");
		expect(verifyInboundSignature({ rawBody: raw, headerSignature: `sha256=${sig}`, secret }).ok).toBe(
			true,
		);
		expect(verifyInboundSignature({ rawBody: raw, headerSignature: "sha256=dead", secret }).ok).toBe(
			false,
		);
		expect(verifyInboundSignature({ rawBody: raw, headerSignature: null, secret }).ok).toBe(false);
	});

	it("normalizes inbound ticket payloads", () => {
		const n = normalizeInboundTicket({
			eventType: "ticket.create",
			ticket: { title: "Need access", description: "VPN", priority: "high" },
			externalId: "ext-1",
		});
		expect(n.title).toBe("Need access");
		expect(n.externalId).toBe("ext-1");
		expect(n.eventType).toBe("ticket.create");
	});
});

describe("ITSM service", () => {
	beforeEach(() => {
		reset();
		vi.clearAllMocks();
	});
	afterEach(() => {
		reset();
	});

	it("creates and lists connections without leaking credentials", async () => {
		const created = await createItsmConnection(
			{
				name: "Ops webhook",
				provider: "generic_webhook",
				direction: "bidirectional",
				credentials: { webhookSecret: "abc" },
				config: { webhookUrl: "https://hooks.example.com/x", createOnInbound: true },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: null },
		);
		expect(created.name).toBe("Ops webhook");
		expect(created.hasCredentials).toBe(true);
		expect((created as { credentials?: unknown }).credentials).toBeUndefined();
		const list = await listItsmConnections();
		expect(list).toHaveLength(1);
	});

	it("rejects outbound create without webhookUrl", async () => {
		await expect(
			createItsmConnection({
				name: "bad",
				provider: "slack",
				direction: "outbound",
				config: {},
			}),
		).rejects.toThrow();
	});

	it("handles signed inbound ticket create", async () => {
		const conn = await createItsmConnection(
			{
				name: "Inbound",
				provider: "generic_webhook",
				direction: "inbound",
				credentials: { webhookSecret: "sec" },
				config: { createOnInbound: true, defaultPriority: "HIGH" },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: null },
		);
		const rawBody = JSON.stringify({
			eventType: "ticket.create",
			externalId: "ext-99",
			ticket: { title: "From IM", description: "Please help" },
		});
		const sig = createHmac("sha256", "sec").update(rawBody).digest("hex");
		const result = await handleInboundWebhook({
			connectionId: conn.id,
			rawBody,
			signatureHeader: `sha256=${sig}`,
			json: JSON.parse(rawBody) as Record<string, unknown>,
			systemUserId: "sys",
		});
		expect(result.action).toBe("create");
		expect(result.ticketId).toMatch(/^tk_/);
		expect(result.event.status).toBe("ok");
	});

	it("rejects inbound with bad signature", async () => {
		const conn = await createItsmConnection(
			{
				name: "Inbound2",
				provider: "generic_webhook",
				direction: "inbound",
				credentials: { webhookSecret: "sec" },
				config: { createOnInbound: true },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: null },
		);
		await expect(
			handleInboundWebhook({
				connectionId: conn.id,
				rawBody: "{}",
				signatureHeader: "sha256=00",
				json: {},
				systemUserId: "sys",
			}),
		).rejects.toThrow(/signature|Invalid/i);
	});

	it("records outbound test delivery", async () => {
		const conn = await createItsmConnection(
			{
				name: "Out",
				provider: "generic_webhook",
				direction: "outbound",
				config: { webhookUrl: "https://hooks.example.com/y" },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: null },
		);
		const result = await testItsmConnection(conn.id, "ping");
		expect(result.ok).toBe(true);
		expect(result.event.eventType).toBe("connection.test");
	});

	it("stamps inbound-created tickets with connection teamId", async () => {
		const conn = await createItsmConnection(
			{
				name: "Team inbound",
				provider: "generic_webhook",
				direction: "inbound",
				credentials: { webhookSecret: "sec" },
				config: { createOnInbound: true },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: "team_ops" },
		);
		expect(conn.teamId).toBe("team_ops");
		const rawBody = JSON.stringify({
			eventType: "ticket.create",
			ticket: { title: "Scoped", description: "from team conn" },
		});
		const sig = createHmac("sha256", "sec").update(rawBody).digest("hex");
		const result = await handleInboundWebhook({
			connectionId: conn.id,
			rawBody,
			signatureHeader: `sha256=${sig}`,
			json: JSON.parse(rawBody) as Record<string, unknown>,
			systemUserId: "sys",
		});
		expect(result.action).toBe("create");
		const ticket = ticketStore.get(result.ticketId!);
		expect(ticket?.teamId).toBe("team_ops");
	});

	it("rejects inbound comment on ticket outside connection team", async () => {
		const conn = await createItsmConnection(
			{
				name: "Team inbound comment",
				provider: "generic_webhook",
				direction: "inbound",
				credentials: { webhookSecret: "sec" },
				config: { createOnInbound: true },
			},
			{ userId: "user1", roles: ["admin"], currentTeamId: "team_ops" },
		);
		// Foreign-team ticket planted in store
		ticketStore.set("tk_foreign", {
			id: "tk_foreign",
			title: "Other",
			status: "OPEN",
			teamId: "team_other",
		});
		const rawBody = JSON.stringify({
			eventType: "ticket.comment",
			ticketId: "tk_foreign",
			comment: { body: "cross-team poke" },
		});
		const sig = createHmac("sha256", "sec").update(rawBody).digest("hex");
		// Processing error is recorded on ItsmEvent + lastError, then rethrown so
		// the public route can map it to a non-2xx response (no HTTP false success).
		await expect(
			handleInboundWebhook({
				connectionId: conn.id,
				rawBody,
				signatureHeader: `sha256=${sig}`,
				json: JSON.parse(rawBody) as Record<string, unknown>,
				systemUserId: "sys",
			}),
		).rejects.toThrow(/not found/i);
	});

	it("ignores non-admin body.teamId spoof on create", async () => {
		const created = await createItsmConnection(
			{
				name: "Spoof attempt",
				provider: "slack",
				direction: "outbound",
				config: { webhookUrl: "https://hooks.example.com/z" },
				teamId: "team_victim",
			},
			{ userId: "u_op", roles: ["operator"], currentTeamId: "team_ops" },
		);
		// Non-admin must get session team, not body spoof
		expect(created.teamId).toBe("team_ops");
	});
});
