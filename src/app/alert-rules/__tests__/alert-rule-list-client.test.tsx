import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AlertRuleListClient } from "../alert-rule-list-client";

vi.mock("@/lib/auth/require-session", () => ({
	requireSession: vi.fn(async () => ({ userId: "admin", role: "admin", permissions: ["notification:manage"] })),
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn(() => true),
}));
vi.mock("@/lib/alert/service", () => ({
	listAlertRules: vi.fn(async () => [{
		id: "rule1",
		name: "Webhook rule",
		metric: "cpu_usage",
		operator: "gte",
		threshold: 90,
		durationSeconds: 0,
		serverIds: [],
		notifyChannels: ["webhook"],
		webhookUrl: "https://hooks.example.com/path/secret-token",
		cooldownMinutes: 10,
		enabled: true,
		lastTriggeredAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
	}]),
}));
vi.mock("@/lib/server/service", () => ({
	listServerProfiles: vi.fn(async () => []),
}));

import AlertRulesPage from "../page";

describe("alert rules client", () => {
	it("does not render full webhook URLs from serialized rule metadata", () => {
		render(<AlertRuleListClient
			rules={[{
				id: "rule1",
				name: "Webhook rule",
				metric: "cpu_usage",
				operator: "gte",
				threshold: 90,
				durationSeconds: 0,
				serverIds: [],
				notifyChannels: ["webhook"],
				webhookConfigured: true,
				cooldownMinutes: 10,
				enabled: true,
				lastTriggeredAt: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			}]}
			servers={[]}
			canManage={true}
		/>);

		expect(screen.getByText("Webhook rule")).toBeInTheDocument();
		expect(screen.getByText("Webhook 已配置")).toBeInTheDocument();
		expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
	});

	it("redacts webhook URLs before passing server-rendered rules to the client", async () => {
		const page = await AlertRulesPage();
		render(page);

		await waitFor(() => expect(screen.getByText("Webhook rule")).toBeInTheDocument());
		expect(screen.getByText("Webhook 已配置")).toBeInTheDocument();
		expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
	});
});
