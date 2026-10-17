import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	server: { findUnique: vi.fn(), findMany: vi.fn() },
	publicStatusNode: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
	$transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
	MAX_POINTS,
	RANGE_SECONDS,
	availabilityFromCoverage,
	bucketSecondsFor,
	insertGaps,
	shapeNetworkPoints,
	shapeResourcePoints,
} from "../history";
import { applyNodeBatch, generatePublicId, normalizePublication, updateNodePublication } from "../nodes-admin";
import { PUBLIC_ID_PATTERN, HISTORY_RANGES } from "../query";
import { PUBLIC_METRIC_CATEGORIES, cleanPlainText, publicSiteUpdateSchema, siteConfigFromRow } from "../site-config";

describe("history shaping", () => {
	it("keeps every range at or below the point budget with at least minute buckets", () => {
		for (const range of HISTORY_RANGES) {
			const bucket = bucketSecondsFor(range);
			expect(bucket).toBeGreaterThanOrEqual(60);
			expect(Math.ceil(RANGE_SECONDS[range] / bucket)).toBeLessThanOrEqual(MAX_POINTS);
		}
		expect(bucketSecondsFor("7d")).toBe(1680);
	});

	it("inserts a null point across silence instead of joining the line", () => {
		const points = [
			{ t: "2026-10-13T00:00:00.000Z", v: 1 },
			{ t: "2026-10-13T00:05:00.000Z", v: 2 },
			{ t: "2026-10-13T02:00:00.000Z", v: 3 },
		];
		const out = insertGaps(points, 601, (t) => ({ t, v: null as number | null }));
		expect(out.map((p) => p.v)).toEqual([1, 2, null, 3]);
	});

	it("never draws offline-only buckets as zero and counts probes honestly", () => {
		const b = (minute: number) => new Date(Date.UTC(2026, 9, 13, 0, minute));
		const shaped = shapeResourcePoints(
			[
				{ b: b(0), cpu: 10, mem: 20, disk: 30, online: BigInt(1), offline: BigInt(0), probe_ok: BigInt(1), probe_failed: BigInt(0), rtt_avg: 12, rtt_min: 12, rtt_max: 12, interval_s: 300, load1: 0.567, procs: 101.6, tcp: 10.2, udp: 2.5 },
				{ b: b(5), cpu: null, mem: null, disk: null, online: BigInt(0), offline: BigInt(1), probe_ok: BigInt(0), probe_failed: BigInt(1), rtt_avg: null, rtt_min: null, rtt_max: null, interval_s: 300, load1: null, procs: null, tcp: null, udp: null },
				{ b: b(10), cpu: 11, mem: 21, disk: 31, online: BigInt(1), offline: BigInt(0), probe_ok: BigInt(0), probe_failed: BigInt(0), rtt_avg: null, rtt_min: null, rtt_max: null, interval_s: 300, load1: null, procs: null, tcp: null, udp: null },
			],
			60,
			300,
		);
		expect(shaped.resources.map((p) => p.cpu)).toEqual([10, null, 11]);
		expect(shaped.resources[0]).toMatchObject({ load: 0.57, processes: 102, tcp: 10, udp: 3 });
		expect(shaped.resources[1]).toMatchObject({ online: 0, offline: 1, load: null, processes: null });
		// The unprobed bucket is not a latency point at all; the failed one has no value.
		expect(shaped.latency.map((p) => [p.avg, p.failed])).toEqual([[12, 0], [null, 1]]);
		expect(shaped).toMatchObject({ probes: 2, failed: 1 });
	});

	it("keeps network rates as bytes per second and unknown steps as null", () => {
		const points = shapeNetworkPoints(
			[
				{ b: new Date("2026-10-13T00:00:00.000Z"), rx: 1234.4, tx: null },
				{ b: new Date("2026-10-13T00:05:00.000Z"), rx: 99.6, tx: 5 },
			],
			60,
			300,
		);
		expect(points).toEqual([
			{ t: "2026-10-13T00:00:00.000Z", rx: 1234, tx: null },
			{ t: "2026-10-13T00:05:00.000Z", rx: 100, tx: 5 },
		]);
	});

	it("computes availability over covered time only and flags thin coverage", () => {
		expect(availabilityFromCoverage({ samples: 288, covered: 86_400, onlineCovered: 86_100 }, 86_400)).toEqual({ percent: 99.65, coveragePercent: 100, samples: 288, sufficient: true });
		expect(availabilityFromCoverage({ samples: 3, covered: 900, onlineCovered: 900 }, 86_400)).toMatchObject({ percent: 100, coveragePercent: 1, sufficient: false });
		expect(availabilityFromCoverage({ samples: 0, covered: 0, onlineCovered: 0 }, 86_400)).toMatchObject({ percent: null, sufficient: false });
	});
});

describe("site settings", () => {
	it("defaults to a closed board with every category except billing", () => {
		expect(siteConfigFromRow(null)).toMatchObject({ enabled: false, defaultView: "cards", refreshSeconds: 15, accent: "default" });
		expect(siteConfigFromRow(null).metrics).toHaveLength(PUBLIC_METRIC_CATEGORIES.length - 1);
		expect(siteConfigFromRow(null).metrics).not.toContain("billing");
	});

	it("sanitises unknown stored values", () => {
		const site = siteConfigFromRow({
			enabled: true, title: "t", description: null, announcement: null, defaultView: "grid", refreshSeconds: 7,
			accent: "neon", metrics: ["cpu", "secrets"], showPlatformStatus: false, updatedAt: new Date(0),
		});
		expect(site).toMatchObject({ defaultView: "cards", refreshSeconds: 15, accent: "default", metrics: ["cpu"] });
	});

	it("keeps text plain: control characters removed, length capped, empty → null", () => {
		expect(cleanPlainText("  hi\u0000\r\nthere\u0007 ", 100)).toBe("hi\nthere");
		expect(cleanPlainText("<b>x</b>", 100)).toBe("<b>x</b>");
		expect(cleanPlainText("   ", 10)).toBeNull();
		expect(cleanPlainText("abcdef", 3)).toBe("abc");
	});

	it("rejects unknown keys, refresh values and categories", () => {
		const ok = { enabled: true, title: null, description: null, announcement: null, defaultView: "table", refreshSeconds: 30, accent: "rose", metrics: ["cpu"], showPlatformStatus: true };
		expect(publicSiteUpdateSchema.safeParse(ok).success).toBe(true);
		expect(publicSiteUpdateSchema.safeParse({ ...ok, refreshSeconds: 1 }).success).toBe(false);
		expect(publicSiteUpdateSchema.safeParse({ ...ok, metrics: ["host"] }).success).toBe(false);
		expect(publicSiteUpdateSchema.safeParse({ ...ok, html: "<script>" }).success).toBe(false);
	});
});

describe("node publication (admin)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.server.findUnique.mockResolvedValue({ id: "s1", name: "internal-db-01", host: "203.0.113.7", teamId: "team_a" });
		prismaMock.publicStatusNode.findUnique.mockResolvedValue(null);
		prismaMock.publicStatusNode.upsert.mockResolvedValue({ publicId: "abcdefghijkl", published: true });
	});

	const input = { displayName: "Tokyo", groupName: null, region: "JP", tags: [" a ", "a", "b"], sortOrder: 1, note: null, maintenance: false, published: true };

	it("issues unrelated 12-character public ids", () => {
		const ids = new Set(Array.from({ length: 200 }, () => generatePublicId()));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(PUBLIC_ID_PATTERN);
	});

	it("normalises fields to single lines and dedupes tags", () => {
		expect(normalizePublication({ ...input, displayName: "  Tok\nyo  " })).toMatchObject({ displayName: "Tok yo", tags: ["a", "b"] });
	});

	it("requires an explicit public name (no fallback to the internal name)", async () => {
		await expect(updateNodePublication("s1", { ...input, displayName: "   " }, "admin")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
		expect(prismaMock.publicStatusNode.upsert).not.toHaveBeenCalled();
	});

	it("refuses public text that contains the host address", async () => {
		await expect(updateNodePublication("s1", { ...input, note: "ssh 203.0.113.7" }, "admin")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
		await expect(updateNodePublication("s1", { ...input, tags: ["203.0.113.7"] }, "admin")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
	});

	it("records the owner at publish time", async () => {
		await updateNodePublication("s1", input, "admin");
		const call = prismaMock.publicStatusNode.upsert.mock.calls[0]![0];
		expect(call.create).toMatchObject({ serverId: "s1", published: true, publishedTeamId: "team_a", publishedById: "admin", displayName: "Tokyo" });
		expect(call.create.publicId).toMatch(PUBLIC_ID_PATTERN);
		expect(call.update.publishedTeamId).toBe("team_a");
	});

	it("unpublishing keeps the owner snapshot untouched and clears publishedAt", async () => {
		await updateNodePublication("s1", { ...input, published: false }, "admin");
		const call = prismaMock.publicStatusNode.upsert.mock.calls[0]![0];
		expect(call.update).not.toHaveProperty("publishedTeamId");
		expect(call.update).toMatchObject({ published: false, publishedAt: null });
	});

	it("404s an unknown server", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce(null);
		await expect(updateNodePublication("nope", input, "admin")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("batch publish skips servers without a configured public name", async () => {
		prismaMock.publicStatusNode.findMany.mockResolvedValue([{ serverId: "s1", displayName: "Tokyo", server: { teamId: "team_a" } }]);
		prismaMock.publicStatusNode.update.mockResolvedValue({});
		const result = await applyNodeBatch({ action: "publish", serverIds: ["s1", "s2"] }, "admin");
		expect(result).toEqual({ changed: 1, skipped: ["s2"] });
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
		expect(prismaMock.$transaction.mock.calls[0]![0]).toHaveLength(1);
		expect(prismaMock.publicStatusNode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { serverId: "s1" }, data: expect.objectContaining({ published: true, publishedTeamId: "team_a" }) }));
	});

	it("takes a two-letter country code for the flag and refuses anything else", () => {
		expect(normalizePublication({ ...input, countryCode: " jp " })).toMatchObject({ countryCode: "JP" });
		expect(normalizePublication({ ...input, countryCode: "" })).toMatchObject({ countryCode: null });
		expect(normalizePublication(input)).toMatchObject({ countryCode: null });
		expect(() => normalizePublication({ ...input, countryCode: "JPN" })).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
	});

	it("publishes with server names: keeps existing public names, names the rest, skips host leaks and unknown ids", async () => {
		prismaMock.server.findMany.mockResolvedValue([
			{ id: "s1", name: "tokyo-1", host: "203.0.113.7", teamId: "team_a", publicStatusNode: { displayName: "Tokyo Edge" } },
			{ id: "s2", name: "osaka-2", host: "203.0.113.8", teamId: "team_a", publicStatusNode: null },
			{ id: "s3", name: "web 203.0.113.9", host: "203.0.113.9", teamId: null, publicStatusNode: { displayName: "" } },
		]);
		const result = await applyNodeBatch({ action: "publish_named", serverIds: ["s1", "s2", "s3", "gone"] }, "admin");
		expect(result).toEqual({ changed: 2, skipped: ["gone", "s3"] });
		const calls = prismaMock.publicStatusNode.upsert.mock.calls.map((call) => call[0]);
		expect(calls).toHaveLength(2);
		// An existing public name is kept; only publication fields change.
		expect(calls[0]).toMatchObject({ where: { serverId: "s1" }, update: { published: true, publishedTeamId: "team_a", publishedById: "admin" } });
		expect(calls[0].update).not.toHaveProperty("displayName");
		// A server without one is published under its server name.
		expect(calls[1]).toMatchObject({ where: { serverId: "s2" }, create: { displayName: "osaka-2", published: true }, update: { displayName: "osaka-2" } });
		expect(calls[1].create.publicId).toMatch(PUBLIC_ID_PATTERN);
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
	});
});
