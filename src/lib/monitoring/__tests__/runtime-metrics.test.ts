import { afterEach, describe, expect, it } from "vitest";

import {
	__resetRuntimeMetricsForTests,
	getDeliverySnapshot,
	getObservabilitySnapshot,
	getWebVitalSnapshot,
	getWsSnapshot,
	recordDelivery,
	recordWebVital,
	recordWsEvent,
	setWsActive,
	snapshotLatency,
	timeDelivery,
} from "../runtime-metrics";

afterEach(() => {
	__resetRuntimeMetricsForTests();
});

describe("snapshotLatency", () => {
	it("returns null percentiles for empty series", () => {
		expect(snapshotLatency([])).toEqual({ count: 0, p50: null, p95: null, p99: null, max: null });
	});

	it("computes percentiles for a sorted series", () => {
		const snap = snapshotLatency([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
		expect(snap.count).toBe(10);
		expect(snap.p50).toBe(50);
		expect(snap.max).toBe(100);
		expect(snap.p95).toBeGreaterThanOrEqual(90);
	});
});

describe("web vitals", () => {
	it("records samples and exposes recent + aggregate snapshot", () => {
		recordWebVital({ name: "LCP", value: 1200, rating: "good", path: "/dashboard" });
		recordWebVital({ name: "LCP", value: 2800, rating: "needs-improvement", path: "/files" });
		recordWebVital({ name: "INP", value: 180, rating: "good" });

		const snap = getWebVitalSnapshot();
		expect(snap.byName.LCP.count).toBe(2);
		expect(snap.byName.INP.count).toBe(1);
		expect(snap.recent[0]?.name).toBe("INP");
	});

	it("ignores invalid names and non-finite values", () => {
		recordWebVital({ name: "LCP", value: Number.NaN });
		// @ts-expect-error intentional invalid metric name
		recordWebVital({ name: "BOGUS", value: 1 });
		expect(getWebVitalSnapshot().byName.LCP.count).toBe(0);
	});
});

describe("delivery metrics", () => {
	it("tracks success/failure and latency percentiles", async () => {
		recordDelivery("email", { ok: true, durationMs: 40 });
		recordDelivery("email", { ok: false, durationMs: 120 });
		await expect(
			timeDelivery("telegram", async () => {
				await new Promise((r) => setTimeout(r, 5));
				return "ok";
			}),
		).resolves.toBe("ok");
		await expect(
			timeDelivery("webhook", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const snap = getDeliverySnapshot();
		expect(snap.email.success).toBe(1);
		expect(snap.email.failure).toBe(1);
		expect(snap.email.failureRate).toBeCloseTo(0.5);
		expect(snap.telegram.success).toBe(1);
		expect(snap.webhook.failure).toBe(1);
		expect(snap.email.latency.count).toBe(2);
	});
});

describe("websocket metrics", () => {
	it("tracks open/close/error/reject and active count", () => {
		recordWsEvent("notification", "open");
		recordWsEvent("notification", "open");
		recordWsEvent("notification", "close");
		recordWsEvent("notification", "error");
		recordWsEvent("ssh", "reject");
		setWsActive("ssh", 3);

		const snap = getWsSnapshot();
		expect(snap.notification.active).toBe(1);
		expect(snap.notification.opened).toBe(2);
		expect(snap.notification.closed).toBe(1);
		expect(snap.notification.errors).toBe(1);
		expect(snap.ssh.rejected).toBe(1);
		expect(snap.ssh.active).toBe(3);
	});
});

describe("getObservabilitySnapshot", () => {
	it("returns a combined snapshot envelope", () => {
		recordWebVital({ name: "CLS", value: 0.05 });
		recordDelivery("in_app_ws", { ok: true, durationMs: 2 });
		recordWsEvent("notification", "open");
		const snap = getObservabilitySnapshot();
		expect(snap.collectedAt).toEqual(expect.any(String));
		expect(snap.webVitals.byName.CLS.count).toBe(1);
		expect(snap.delivery.in_app_ws.success).toBe(1);
		expect(snap.websocket.notification.opened).toBe(1);
	});
});
