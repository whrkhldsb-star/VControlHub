// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { delivered } = vi.hoisted(() => ({ delivered: [] as string[] }));
vi.mock("../adapters", async (importOriginal) => ({
	...(await importOriginal<typeof import("../adapters")>()),
	deliverOutbound: vi.fn(async (input: { config: { webhookUrl?: string } }) => {
		delivered.push(input.config.webhookUrl ?? "");
		return { ok: true, statusCode: 200 };
	}),
}));

import { prisma } from "@/lib/db";
import { enqueueTicketEvent } from "../outbox";
import { createTicket, addTicketComment, updateTicketStatus } from "@/lib/ticket/service";
import { deliverOutbound } from "../adapters";
import { adoptLegacyTicketJobs } from "../outbox";
import { deliverQueuedEvent, reconcileDelivery } from "../service-outbound";

/**
 * A ticket event reaches every outbound connection of its customer. One page
 * of 50 connections of any direction was read and filtered afterwards:
 * inbound-only connections crowded out the outbound one, which never got
 * the event while the job completed.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ITSM outbound fan-out (PostgreSQL)", () => {
	const trigger = "b8_job_failure_" + randomUUID().replaceAll("-", "");
	const prefix = `itsm-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "test" } });
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		await prisma.itsmConnection.createMany({
			data: Array.from({ length: 51 }, (_, i) => ({ id: `${prefix}-a${String(i).padStart(2, "0")}`, name: `inbound ${i}`, provider: "generic_webhook", direction: "inbound", teamId: prefix })),
		});
		await prisma.itsmConnection.create({
			data: { id: `${prefix}-zz-out`, name: "outbound", provider: "generic_webhook", direction: "outbound", teamId: prefix, config: { webhookUrl: "https://hooks.example.test/itsm" } },
		});
	});
	afterAll(async () => {
		await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON jobs`);
		await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
		await prisma.job.deleteMany({ where: { teamId: prefix } });
		await prisma.itsmEvent.deleteMany({ where: { teamId: prefix } });
		await prisma.itsmConnection.deleteMany({ where: { teamId: prefix } });
		await prisma.ticket.deleteMany({ where: { teamId: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("delivers to the outbound connection behind 51 inbound-only ones", async () => {
		await prisma.$transaction((tx) => enqueueTicketEvent(tx, {
			id: prefix + "-ticket", teamId: prefix, title: "t", description: "d", status: "OPEN", priority: "HIGH", category: null,
		}, "ticket.created"));
		const event = await prisma.itsmEvent.findFirstOrThrow({ where: { teamId: prefix } });
		const result = await deliverQueuedEvent(event.id);
		expect(result).toEqual({ sent: 1, failed: 0 });
		expect(delivered).toEqual(["https://hooks.example.test/itsm"]);
	});

	const snapshot = (id: string) => ({ id, teamId: prefix, title: id, description: "body", status: "OPEN", priority: "NORMAL", category: null });
	const append = (id: string, type: string, status = "OPEN", comment?: string) =>
		prisma.$transaction((tx) => enqueueTicketEvent(tx, { ...snapshot(id), status }, type, comment));
	const events = (ticketId: string) => prisma.itsmEvent.findMany({ where: { ticketId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
	const queued = (eventId: string) => prisma.job.count({ where: { teamId: prefix, type: "itsm.outbound", payload: { path: ["eventId"], equals: eventId } } });
	const session = { userId: prefix, username: prefix, roles: [], permissions: ["ticket:manage" as const], mustChangePassword: false, currentTeamId: prefix };

	it("keeps later status snapshots and comments behind a failed head through retry", async () => {
		const ticketId = prefix + "-ordered";
		await append(ticketId, "ticket.status_changed", "IN_PROGRESS");
		await append(ticketId, "ticket.comment", "IN_PROGRESS", "first reply");
		await append(ticketId, "ticket.status_changed", "RESOLVED");
		const [a, b, c] = await events(ticketId);
		expect(await Promise.all([a!, b!, c!].map((event) => queued(event.id)))).toEqual([1, 0, 0]);
		vi.mocked(deliverOutbound).mockClear().mockResolvedValueOnce({ ok: false, statusCode: 429 });
		await expect(deliverQueuedEvent(a!.id)).resolves.toEqual({ sent: 0, failed: 1 });
		expect(await queued(b!.id)).toBe(0);
		for (const event of [a!, b!, c!]) {
			expect(await queued(event.id)).toBe(1);
			expect(await deliverQueuedEvent(event.id)).toEqual({ sent: 1, failed: 0 });
		}
		const sent = vi.mocked(deliverOutbound).mock.calls.map(([{ payload }]) => [payload.eventId, payload.commentBody, payload.status]);
		expect(sent).toEqual([
			[a!.externalId, undefined, "IN_PROGRESS"], [a!.externalId, undefined, "IN_PROGRESS"],
			[b!.externalId, "first reply", "IN_PROGRESS"], [c!.externalId, undefined, "RESOLVED"],
		]);
	});

	it("reserves before I/O and requires a scoped reconciliation after a lost receipt", async () => {
		const ticketId = prefix + "-no-receipt";
		await append(ticketId, "ticket.comment", "OPEN", "remote comment");
		await append(ticketId, "ticket.updated");
		const [first, next] = await events(ticketId);
		vi.mocked(deliverOutbound).mockClear().mockImplementationOnce(async () => {
			expect(await prisma.itsmEvent.findUnique({ where: { id: first!.id } })).toMatchObject({ status: "unknown" });
			throw new Error("lost after remote commit");
		});
		await expect(deliverQueuedEvent(first!.id)).rejects.toThrow("lost after remote commit");
		expect(await deliverQueuedEvent(first!.id)).toEqual({ sent: 0, failed: 1 });
		expect(vi.mocked(deliverOutbound)).toHaveBeenCalledTimes(1);
		expect(await queued(next!.id)).toBe(0);
		await expect(reconcileDelivery({ ...session, currentTeamId: "other-team" }, first!.id, true)).rejects.toMatchObject({ status: 404 });
		await reconcileDelivery(session, first!.id, true);
		expect(await queued(next!.id)).toBe(1);
		expect(await deliverQueuedEvent(first!.id)).toEqual({ sent: 1, failed: 0 });
		expect(vi.mocked(deliverOutbound)).toHaveBeenCalledTimes(1);
	});

	it("replays the identical ID and timestamp only for an opted-in idempotent receiver", async () => {
		const id = prefix + "-zz-out";
		const base = { webhookUrl: "https://hooks.example.test/itsm" };
		await prisma.itsmConnection.update({ where: { id }, data: { config: { ...base, idempotentDelivery: true } } });
		try {
			const ticketId = prefix + "-idempotent";
			await append(ticketId, "ticket.comment", "OPEN", "note");
			const [event] = await events(ticketId);
			vi.mocked(deliverOutbound).mockClear().mockResolvedValueOnce({ ok: false, outcomeUnknown: true });
			await deliverQueuedEvent(event!.id);
			await deliverQueuedEvent(event!.id);
			const calls = vi.mocked(deliverOutbound).mock.calls;
			expect(calls).toHaveLength(2);
			expect(calls[1]![0].payload).toEqual(calls[0]![0].payload);
			expect(calls[0]![0].payload.eventId).toBe(event!.externalId);
			const uncertain = prefix + "-changed-receiver";
			await append(uncertain, "ticket.comment", "OPEN", "another note");
			const [prior] = await events(uncertain);
			vi.mocked(deliverOutbound).mockClear()
				.mockResolvedValueOnce({ ok: false, outcomeUnknown: true })
				.mockResolvedValueOnce({ ok: false, statusCode: 429 });
			await deliverQueuedEvent(prior!.id);
			await deliverQueuedEvent(prior!.id);
			await prisma.itsmConnection.update({ where: { id }, data: { config: { idempotentDelivery: true, webhookUrl: "https://another.example.test/events" } } });
			expect(await deliverQueuedEvent(prior!.id)).toEqual({ sent: 0, failed: 1 });
			expect(deliverOutbound).toHaveBeenCalledTimes(2);
			await reconcileDelivery(session, prior!.id, false);
			expect(await deliverQueuedEvent(prior!.id)).toEqual({ sent: 1, failed: 0 });
		} finally {
			await prisma.itsmConnection.update({ where: { id }, data: { config: base } });
		}
	});

	it("isolates a corrupt connection and stops queued deliveries when the customer is deleted", async () => {
		const bad = await prisma.itsmConnection.create({ data: {
			id: prefix + "-aa-bad", teamId: prefix, name: "bad", provider: "generic_webhook", direction: "outbound",
			config: { webhookUrl: "https://hooks.example.test/itsm" }, credentialsEnc: "{bad",
		} });
		try {
			const ticketId = prefix + "-isolated";
			await append(ticketId, "ticket.updated");
			const rows = await events(ticketId);
			const broken = rows.find((event) => event.connectionId === bad.id)!;
			expect(await deliverQueuedEvent(broken.id)).toEqual({ sent: 0, failed: 1 });
			expect(await prisma.itsmEvent.findUnique({ where: { id: broken.id } })).toMatchObject({ status: "error" });
			expect(await deliverQueuedEvent(rows.find((event) => event.id !== broken.id)!.id)).toEqual({ sent: 1, failed: 0 });
			await append(prefix + "-retired", "ticket.updated");
			await prisma.team.update({ where: { id: prefix }, data: { deletedAt: new Date() } });
			vi.mocked(deliverOutbound).mockClear();
			for (const event of await events(prefix + "-retired")) {
				expect(await deliverQueuedEvent(event.id)).toEqual({ sent: 0, failed: 0 });
				expect(await prisma.itsmEvent.findUnique({ where: { id: event.id } })).toMatchObject({ status: "ignored" });
			}
			expect(vi.mocked(deliverOutbound)).not.toHaveBeenCalled();
		} finally {
			await prisma.team.update({ where: { id: prefix }, data: { deletedAt: null } });
			await prisma.itsmConnection.delete({ where: { id: bad.id } });
		}
	});

	it("adopts existing queued snapshots in their original order, including a head in backoff", async () => {
		const ticketId = prefix + "-legacy";
		const old = async (n: number) => prisma.job.create({ data: {
			type: "itsm.outbound", teamId: prefix, title: "legacy", createdAt: new Date(1000 * n),
			availableAt: new Date(Date.now() + (n === 1 ? 30_000 : 0)), payload: { ...snapshot(ticketId), ticketId, eventType: "ticket.comment", commentBody: String(n) },
		} });
		const a = await old(1), b = await old(2);
		await adoptLegacyTicketJobs(ticketId);
		await adoptLegacyTicketJobs(ticketId);
		const all = await events(ticketId);
		expect(all.map((event) => event.externalId).sort()).toEqual([a.id, b.id].sort());
		for (const job of [a, b]) {
			const event = all.find((row) => row.externalId === job.id)!;
			expect(await queued(event.id)).toBe(1);
			await deliverQueuedEvent(event.id);
		}
	});

	it("rolls back create, status history and comments on a job insert failure", async () => {
		const ticket = await prisma.ticket.create({ data: { ...snapshot(prefix + "-atomic"), createdBy: prefix } });
		await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN IF NEW."teamId" = '${prefix}' AND NEW.type = 'itsm.outbound' THEN RAISE EXCEPTION 'outbox unavailable'; END IF; RETURN NEW; END $$`);
		await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
		try {
			await expect(createTicket({ title: "atomic-create", description: "d", createdBy: prefix, session })).rejects.toThrow(/outbox unavailable/);
			await expect(updateTicketStatus({ id: ticket.id, status: "IN_PROGRESS", session })).rejects.toThrow(/outbox unavailable/);
			await expect(addTicketComment({ ticketId: ticket.id, authorId: prefix, body: "atomic-comment", session })).rejects.toThrow(/outbox unavailable/);
			expect(await prisma.ticket.count({ where: { teamId: prefix, title: "atomic-create" } })).toBe(0);
			expect(await prisma.ticket.findUnique({ where: { id: ticket.id }, include: { comments: true, escalations: true } })).toMatchObject({ status: "OPEN", comments: [], escalations: [] });
			expect(await events(ticket.id)).toEqual([]);
		} finally {
			await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON jobs`);
		}
	});

	it("keeps a pre-upgrade retry from overwriting a confirmed newer state, and isolates malformed jobs", async () => {
		const ticketId = prefix + "-legacy-receipt";
		const job = { type: "itsm.outbound", teamId: prefix, title: "legacy" };
		await prisma.job.create({ data: { ...job, payload: { ticketId } } });
		const state = { ...snapshot(ticketId), ticketId, eventType: "ticket.status_changed" };
		const older = await prisma.job.create({ data: { ...job, payload: state, createdAt: new Date(1000) } });
		const newer = await prisma.job.create({ data: { ...job, payload: { ...state, status: "RESOLVED" }, createdAt: new Date(2000), status: "COMPLETED" } });
		await prisma.itsmEvent.create({ data: { connectionId: prefix + "-zz-out", teamId: prefix, ticketId,
			externalId: newer.id, direction: "outbound", ownerBound: true, eventType: state.eventType, status: "ok" } });
		await append(ticketId, "ticket.comment", "RESOLVED", "new comment");
		expect(await prisma.itsmEvent.count({ where: { ticketId, externalId: older.id } })).toBe(0);
		const comment = await prisma.itsmEvent.findFirstOrThrow({ where: { ticketId, eventType: "ticket.comment" } });
		expect(await queued(comment.id)).toBe(1);
	});
});
