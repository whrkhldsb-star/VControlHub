import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import type { SetupChecklistItem } from "@/lib/dashboard/setup-checklist";
import { DashboardSetupChecklist } from "../dashboard-setup-checklist";

const items: SetupChecklistItem[] = [
	{ id: "servers", done: true, href: "/servers" },
	{ id: "alertRules", done: false, href: "/alert-rules" },
	{ id: "notificationOutbound", done: false, href: "/settings" },
	{ id: "backupSchedule", done: false, href: "/backups" },
	{ id: "costMonthly", done: false, href: "/servers" },
];

describe("DashboardSetupChecklist", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("renders pending first-setup items with deep links", async () => {
		render(
			<I18nProvider initialLocale="zh">
				<DashboardSetupChecklist items={items} />
			</I18nProvider>,
		);
		expect(await screen.findByRole("heading", { name: /首次设置/ })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /告警规则/ })).toHaveAttribute("href", "/alert-rules");
		expect(screen.getByRole("link", { name: /通知外发/ })).toHaveAttribute("href", "/settings");
	});

	it("hides after dismiss and persists in localStorage", async () => {
		const user = userEvent.setup();
		render(
			<I18nProvider initialLocale="zh">
				<DashboardSetupChecklist items={items} />
			</I18nProvider>,
		);
		expect(await screen.findByRole("heading", { name: /首次设置/ })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /稍后再说|Dismiss/i }));
		expect(screen.queryByRole("heading", { name: /首次设置/ })).not.toBeInTheDocument();
		expect(window.localStorage.getItem("vch.setupChecklist.dismissed")).toBe("1");
	});

	it("renders nothing when every item is done", () => {
		const done = items.map((i) => ({ ...i, done: true }));
		const { container } = render(
			<I18nProvider initialLocale="zh">
				<DashboardSetupChecklist items={done} />
			</I18nProvider>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
