import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OfflinePage from "../page";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/i18n/use-locale", async () => {
	const actual = await vi.importActual<typeof import("@/lib/i18n/use-locale")>(
		"@/lib/i18n/use-locale",
	);
	return {
		...actual,
		useI18n: () => ({
			locale: "zh",
			setLocale: vi.fn(),
			t: (key: string) => {
				const zh: Record<string, string> = {
					"pwa.offline.description": "网络连接已断开",
					"pwa.offline.retry": "重试连接",
					"pwa.offline.securityNotice": "登录后的页面不会存储到离线缓存",
					"pwa.offline.title": "当前离线",
				};
				return zh[key] ?? key;
			},
			translations: {},
		}),
	};
});

describe("OfflinePage", () => {
	it("renders the offline title and description with i18n strings", () => {
		render(<OfflinePage />);
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("当前离线");
		expect(screen.getByText(/网络连接已断开/)).toBeInTheDocument();
	});

	it("explains that authenticated pages are not cached offline", () => {
		render(<OfflinePage />);
		expect(screen.getByText(/不会存储到离线缓存/)).toBeInTheDocument();
	});

	it("exposes a retry link that goes back to /dashboard", () => {
		render(<OfflinePage />);
		const retry = screen.getByRole("link", { name: /重试连接/ });
		expect(retry).toHaveAttribute("href", "/dashboard");
	});
});
