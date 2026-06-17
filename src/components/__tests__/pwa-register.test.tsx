import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaRegister } from "../pwa-register";
import { ToastProvider } from "../toast-provider";
import { I18nProvider } from "@/lib/i18n/provider";

const swState = vi.hoisted(() => ({
	supported: true,
	registerImpl: null as ((scope: string) => Promise<unknown>) | null,
	waiting: null as ServiceWorker | null,
	installing: null as ServiceWorker | null,
}));

beforeEach(() => {
	swState.supported = true;
	swState.registerImpl = null;
	swState.waiting = null;
	swState.installing = null;

	const fakeRegister = vi.fn(async (script: string, options?: { scope?: string }) => {
		if (swState.registerImpl) {
			return swState.registerImpl(options?.scope ?? "/");
		}
		return {
			scope: options?.scope ?? "/",
			scriptURL: script,
			waiting: swState.waiting,
			installing: swState.installing,
			active: null,
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
	it("renders no DOM nodes of its own (side-effect-only component)", () => {
		const { container, queryByTestId } = render(
			<>
				<span data-testid="marker" />
				<I18nProvider>
					<ToastProvider>
						<PwaRegister />
					</ToastProvider>
				</I18nProvider>
			</>,
		);
		// PwaRegister itself returns null; only the surrounding toast
		// container + the explicit marker should be in the tree.
		expect(queryByTestId("marker")).not.toBeNull();
		const allText = container.textContent ?? "";
		expect(allText).not.toContain("[VControlHub PWA]");
	});

	it("registers /sw.js with scope / on mount", async () => {
		const register = (navigator.serviceWorker as unknown as { register: ReturnType<typeof vi.fn> }).register;
		render(
			<I18nProvider>
				<ToastProvider>
					<PwaRegister />
				</ToastProvider>
			</I18nProvider>,
		);
		// Allow effect to flush.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
	});

	it("gracefully no-ops when navigator.serviceWorker is absent", () => {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: undefined,
		});
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
		render(
			<I18nProvider>
				<ToastProvider>
					<PwaRegister />
				</ToastProvider>
			</I18nProvider>,
		);
		expect(infoSpy).toHaveBeenCalled();
	});
});
