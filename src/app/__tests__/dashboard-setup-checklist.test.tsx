import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import type { SetupChecklistItem } from "@/lib/dashboard/setup-checklist";
import { DashboardSetupChecklist, SETUP_CHECKLIST_DISMISS_KEY, SetupChecklistReopenButton } from "../dashboard-setup-checklist";

const items: SetupChecklistItem[] = [
	{ id: "servers", done: true, href: "/servers", permission: "server:write" },
	{ id: "alertRules", done: false, href: "/alert-rules", permission: "notification:manage" },
	{ id: "notificationOutbound", done: false, href: "/settings#smtp", permission: "user:manage" },
	{ id: "backupSchedule", done: false, href: "/backups", permission: "backup:read" },
	{ id: "costMonthly", done: false, href: "/servers", permission: "server:write" },
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
		expect(screen.getByRole("link", { name: /通知外发/ })).toHaveAttribute("href", "/settings#smtp");
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
		expect(window.localStorage.getItem(SETUP_CHECKLIST_DISMISS_KEY)).toBe("1");
	});

	it("comes back from the header action after it was hidden", async () => {
		const user = userEvent.setup();
		window.localStorage.setItem("vch.setupChecklist.dismissed", "1");
		render(
			<I18nProvider initialLocale="en">
				<SetupChecklistReopenButton pending={4} />
				<DashboardSetupChecklist items={items} />
			</I18nProvider>,
		);
		expect(screen.queryByRole("heading", { name: /First-setup checklist/ })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /Show setup guide/ }));
		expect(await screen.findByRole("heading", { name: /First-setup checklist/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Show setup guide/ })).not.toBeInTheDocument();
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
