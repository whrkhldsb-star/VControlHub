/* eslint-disable @typescript-eslint/no-unused-vars -- test utilities imported for mock registration */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
/* eslint-enable @typescript-eslint/no-unused-vars */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

import { I18nProvider } from "@/lib/i18n/provider";

const { refreshMock, csrfFetchMock } = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	csrfFetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: csrfFetchMock,
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- imported to register the mock
import { csrfFetch } from "@/lib/auth/csrf-client";
import { SettingsClient } from "../settings-client";

const HIGH_RISK_RUNTIME = {
	"runtime.commandExecutionTimeoutMs": "300000",
	"runtime.commandOutputLimitBytes": "262144",
	"runtime.commandStaleRunningAfterMs": "600000",
	"runtime.commandExecutionHeartbeatMs": "60000",
	"runtime.commandReconcileIntervalMs": "60000",
	"runtime.sftpSyncDirectoryTimeoutMs": "60000",
	"runtime.sshWsHeartbeatIntervalMs": "25000",
	"runtime.sshIdleTimeoutSec": "600",
	"runtime.operationTaskListLimit": "100",
	"runtime.aiProviderListLimit": "100",
	"runtime.aiConversationListLimit": "200",
} as const;

const PLATFORM_HIGH_RISK = {
	"password.minLength": "12",
	"password.requireUppercase": "true",
	"password.requireLowercase": "true",
	"password.requireDigit": "true",
	"password.requireSymbol": "true",
	"session.timeout": "3600",
	"smtp.host": "smtp.example.com",
	"smtp.port": "587",
	"smtp.enabled": "false",
	"smtp.user": "user",
	"smtp.pass": "",
	"smtp.from": "no-reply@example.com",
	"smtp.secure": "true",
	"smtp.alertRecipient": "ops@example.com",
	"ai.enabled": "true",
	"ai.defaultModel": "gpt-5",
	"ai.imageBed.enabled": "true",
	"platform.name": "VControlHub",
	"platform.logo": "",
	"platform.brandColor": "#22d3ee",
	"platform.defaultLocale": "zh",
	"platform.themeMode": "system",
	"telegram.enabled": "false",
	"telegram.botToken": "",
	"telegram.chatId": "",
	"webhook.url": "",
	"webhook.secret": "",
} as const;

beforeEach(() => {
	csrfFetchMock.mockReset();
	refreshMock.mockReset();
	// jsdom does not implement HTMLDialogElement.showModal; HighRiskConfirmModal uses <dialog>.
	// Provide a no-op so the modal can mount.
	if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
		HTMLDialogElement.prototype.showModal = function noop() {};
		HTMLDialogElement.prototype.close = function noop() {};
	}
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SettingsClient high-risk field blur warning (TR-014 M02)", () => {
	it("does not show a high-risk warning initially for an untouched high-risk field", () => {
		render(<I18nProvider initialLocale="zh"><SettingsClient settings={{ ...HIGH_RISK_RUNTIME }} canManage /></I18nProvider>);
		expect(screen.queryAllByTestId("high-risk-blur-warning")).toHaveLength(0);
	});

	it("shows a high-risk warning after the user blurs a changed high-risk runtime field", async () => {
		const user = userEvent.setup();
		render(<I18nProvider initialLocale="zh"><SettingsClient settings={{ ...HIGH_RISK_RUNTIME }} canManage /></I18nProvider>);
		const input = screen.getByLabelText("命令执行超时（毫秒）");
		await user.clear(input);
		await user.type(input, "120000");
		await user.tab();
		expect(await screen.findByTestId("high-risk-blur-warning")).toBeInTheDocument();
	});

	it("does NOT show a high-risk warning when the value matches the initial value on blur", async () => {
		const user = userEvent.setup();
		render(<I18nProvider initialLocale="zh"><SettingsClient settings={{ ...HIGH_RISK_RUNTIME }} canManage /></I18nProvider>);
		const input = screen.getByLabelText("命令执行超时（毫秒）");
		// Clear and re-type the same value to trigger change events, then blur
		await user.clear(input);
		await user.type(input, "300000");
		await user.tab();
		// Give React a tick to render
		await waitFor(() => {
			expect(screen.queryAllByTestId("high-risk-blur-warning")).toHaveLength(0);
		});
	});

	it("clears the high-risk warning once the user continues editing the field", async () => {
		const user = userEvent.setup();
		render(<I18nProvider initialLocale="zh"><SettingsClient settings={{ ...HIGH_RISK_RUNTIME }} canManage /></I18nProvider>);
		const input = screen.getByLabelText("命令执行超时（毫秒）");
		await user.clear(input);
		await user.type(input, "120000");
		await user.tab();
		expect(await screen.findByTestId("high-risk-blur-warning")).toBeInTheDocument();
		// Continue editing — the warning should disappear without requiring a save
		await user.type(input, "0");
		await waitFor(() => {
			expect(screen.queryAllByTestId("high-risk-blur-warning")).toHaveLength(0);
		});
	});

	it("does NOT show a high-risk warning for low-risk fields on blur", async () => {
		// platform.name is in the platform section (defaultOpen) and has no explicit riskLevel
		// (i.e. low risk per FieldDef.riskLevel default).
		const user = userEvent.setup();
		render(
			<I18nProvider initialLocale="zh">
				<SettingsClient
					settings={{ ...PLATFORM_HIGH_RISK, "platform.name": "VControlHub" }}
					canManage
				/>
			</I18nProvider>,
		);
		const nameInput = screen.getByLabelText("平台名称");
		await user.clear(nameInput);
		await user.type(nameInput, "新平台名");
		await user.tab();
		await waitFor(() => {
			expect(screen.queryAllByTestId("high-risk-blur-warning")).toHaveLength(0);
		});
	});
});
