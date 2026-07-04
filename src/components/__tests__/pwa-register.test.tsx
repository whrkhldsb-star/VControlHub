import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaRegister } from "../pwa-register";
import { ToastProvider } from "../toast-provider";
import { I18nProvider } from "@/lib/i18n/provider";

const swState = vi.hoisted(() => ({
	supported: true,
	registerImpl: null as ((scope: string) => Promise<unknown>) | null,
	waiting: null as (ServiceWorker & { postMessage: ReturnType<typeof vi.fn> }) | null,
	installing: null as ServiceWorker | null,
	active: null as (ServiceWorker & { postMessage: ReturnType<typeof vi.fn> }) | null,
}));

function renderPwa() {
	return render(
		<I18nProvider>
			<ToastProvider>
				<PwaRegister />
			</ToastProvider>
		</I18nProvider>,
	);
}

beforeEach(() => {
	swState.supported = true;
	swState.registerImpl = null;
	swState.waiting = null;
	swState.installing = null;
	swState.active = { postMessage: vi.fn() } as unknown as ServiceWorker & { postMessage: ReturnType<typeof vi.fn> };

	Object.defineProperty(navigator, "onLine", {
		configurable: true,
		value: true,
	});
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	});

	const fakeRegister = vi.fn(async (script: string, options?: { scope?: string }) => {
		if (swState.registerImpl) {
			return swState.registerImpl(options?.scope ?? "/");
		}
		return {
			scope: options?.scope ?? "/",
			scriptURL: script,
			waiting: swState.waiting,
			installing: swState.installing,
			active: swState.active,
			pushManager: {} as PushManager,
			update: () => Promise.resolve(undefined),
			unregister: () => Promise.resolve(true),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: () => true,
			onupdatefound: null,
		} as unknown as ServiceWorkerRegistration;
	});

	Object.defineProperty(navigator, "serviceWorker", {
		configurable: true,
		value: {
			register: fakeRegister,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			controller: null,
			ready: Promise.resolve({} as ServiceWorkerRegistration),
		} as unknown as ServiceWorkerContainer,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("PwaRegister", () => {
	it("renders no DOM nodes of its own when online and no update is available", () => {
		const { container } = render(
			<>
				<span data-testid="marker" />
				<I18nProvider>
					<ToastProvider>
						<PwaRegister />
					</ToastProvider>
				</I18nProvider>
			</>,
		);
		expect(screen.getByTestId("marker")).toBeInTheDocument();
		expect(container.textContent ?? "").not.toContain("[VControlHub PWA]");
	});

	it("registers /sw.js with scope / on mount", async () => {
		const register = (navigator.serviceWorker as unknown as { register: ReturnType<typeof vi.fn> }).register;
		renderPwa();
		await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
	});

	it("warms read-only routes after registration with an active service worker", async () => {
		renderPwa();
		await waitFor(() => expect(swState.active?.postMessage).toHaveBeenCalled());
		expect(swState.active?.postMessage).toHaveBeenCalledWith({ type: "VCH_PWA_WARM_ROUTE", pathname: "/dashboard" });
		expect(swState.active?.postMessage).toHaveBeenCalledWith({ type: "VCH_PWA_WARM_ROUTE", pathname: "/status" });
	});

	it("gracefully no-ops when navigator.serviceWorker is absent", () => {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: undefined,
		});
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
		renderPwa();
		expect(infoSpy).toHaveBeenCalled();
	});

	it("shows an offline banner when the browser goes offline", async () => {
		renderPwa();
		fireEvent(window, new Event("offline"));
		expect(await screen.findByText(/网络已断开/)).toBeInTheDocument();
	});

	it("shows a refresh prompt when a waiting service worker is present", async () => {
		const postMessage = vi.fn();
		swState.waiting = { postMessage } as unknown as ServiceWorker & { postMessage: ReturnType<typeof vi.fn> };
		renderPwa();
		const refresh = await screen.findByRole("button", { name: "立即刷新" });
		fireEvent.click(refresh);
		expect(postMessage).toHaveBeenCalledWith({ type: "VCH_PWA_SKIP_WAITING" });
	});
});
