import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the two Sentry registration wrappers.
 *
 * These are thin `Sentry.init` calls, and the only behaviour worth holding is the
 * opt-in guard: no DSN configured means no `init` at all. That matters for a
 * self-hosted install — without the guard, a deployment that never configured
 * Sentry would still initialise the SDK, and error/replay data from a private
 * VPS fleet would be prepared for transmission to a third party.
 *
 * `replaysSessionSampleRate` is pinned at 0 on both sides for the same reason:
 * session replay records the operator's screen, including hostnames, file paths
 * and command output. Only on-error replay is enabled, and only when a DSN is
 * present.
 */
const mocks = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({ init: mocks.init }));

const ENV_KEYS = [
	"NEXT_RUNTIME",
	"NEXT_PUBLIC_SENTRY_DSN",
	"NEXT_PUBLIC_SENTRY_RELEASE",
	"NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
	"NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
	"SENTRY_DSN",
	"SENTRY_TRACES_SAMPLE_RATE",
	"SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
] as const;

const saved: Record<string, string | undefined> = {};

describe("sentry registration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.init.mockReset();
		for (const key of ENV_KEYS) saved[key] = process.env[key];
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	describe("registerClientSentry", () => {
		it("does not initialise the SDK when no public DSN is set", async () => {
			// A self-hosted install that never opted in must not start the SDK.
			delete process.env.NEXT_PUBLIC_SENTRY_DSN;
			const { registerClientSentry } = await import("../sentry.client");
			registerClientSentry();
			expect(mocks.init).not.toHaveBeenCalled();
		});

		it("initialises with the configured DSN when one is set", async () => {
			process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.test/1";
			const { registerClientSentry } = await import("../sentry.client");
			registerClientSentry();
			expect(mocks.init).toHaveBeenCalledTimes(1);
			expect(mocks.init.mock.calls[0]![0]).toMatchObject({ dsn: "https://key@sentry.test/1" });
		});

		it("keeps session replay off so an operator's screen is never recorded wholesale", async () => {
			process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.test/1";
			const { registerClientSentry } = await import("../sentry.client");
			registerClientSentry();
			expect(mocks.init.mock.calls[0]![0].replaysSessionSampleRate).toBe(0);
		});

		it("defaults the sample rates when the env vars are absent", async () => {
			process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.test/1";
			delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
			delete process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE;
			const { registerClientSentry } = await import("../sentry.client");
			registerClientSentry();
			expect(mocks.init.mock.calls[0]![0]).toMatchObject({
				tracesSampleRate: 0.1,
				replaysOnErrorSampleRate: 1.0,
			});
		});

		it("parses the configured sample rates", async () => {
			process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.test/1";
			process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.25";
			process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE = "0.5";
			const { registerClientSentry } = await import("../sentry.client");
			registerClientSentry();
			expect(mocks.init.mock.calls[0]![0]).toMatchObject({
				tracesSampleRate: 0.25,
				replaysOnErrorSampleRate: 0.5,
			});
		});
	});

	describe("registerServerSentry", () => {
		it("does nothing outside the nodejs runtime, even with a DSN", async () => {
			// The edge runtime has its own instrumentation entry point; initialising
			// the node SDK there would throw at module scope.
			process.env.NEXT_RUNTIME = "edge";
			const { registerServerSentry } = await import("../sentry.server");
			registerServerSentry();
			expect(mocks.init).not.toHaveBeenCalled();
		});

		it("does nothing in the nodejs runtime when no DSN is configured", async () => {
			process.env.NEXT_RUNTIME = "nodejs";
			delete process.env.SENTRY_DSN;
			const { registerServerSentry } = await import("../sentry.server");
			registerServerSentry();
			expect(mocks.init).not.toHaveBeenCalled();
		});

		it("initialises in the nodejs runtime once a DSN is configured", async () => {
			// `config.sentry.dsn` is a live getter over process.env, so setting the
			// var here exercises the positive branch rather than only the opt-out.
			process.env.NEXT_RUNTIME = "nodejs";
			process.env.SENTRY_DSN = "https://key@sentry.test/2";
			const { registerServerSentry } = await import("../sentry.server");
			registerServerSentry();
			expect(mocks.init).toHaveBeenCalledTimes(1);
			expect(mocks.init.mock.calls[0]![0]).toMatchObject({ dsn: "https://key@sentry.test/2" });
		});

		it("keeps server-side session replay off as well", async () => {
			process.env.NEXT_RUNTIME = "nodejs";
			process.env.SENTRY_DSN = "https://key@sentry.test/2";
			const { registerServerSentry } = await import("../sentry.server");
			registerServerSentry();
			expect(mocks.init.mock.calls[0]![0].replaysSessionSampleRate).toBe(0);
		});

		it("does not initialise on the edge runtime even with a DSN present", async () => {
			process.env.NEXT_RUNTIME = "edge";
			process.env.SENTRY_DSN = "https://key@sentry.test/2";
			const { registerServerSentry } = await import("../sentry.server");
			registerServerSentry();
			expect(mocks.init).not.toHaveBeenCalled();
		});
	});
});
