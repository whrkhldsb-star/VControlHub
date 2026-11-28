import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { type AiCapabilities, DEFAULT_AI_CAPABILITIES, resolveEffectiveMode } from "../ai-automation-mode";
import { AiChatHeader } from "../ai-chat-header";
import { AiFullAutoDialog } from "../ai-full-auto-dialog";
import { AiModeSwitcher } from "../ai-mode-switcher";
import type { ConvItem } from "../ai-types";
import type { AutomationModeController } from "../hooks/use-automation-mode";

const allModes: AiCapabilities = {
	...DEFAULT_AI_CAPABILITIES,
	canAuto: true,
	canFullAuto: true,
	canExecute: true,
	aiMaxAutomationMode: "full_auto",
	aiCommandPolicy: "high_risk",
};
const NOW = Date.parse("2026-11-28T10:00:00.000Z");

function renderSwitcher(caps: AiCapabilities, requested: ConvItem["automationMode"] = "ASSISTED", options: { hostingEnabled?: boolean; expiresAt?: string | null } = {}) {
	const onRequestMode = vi.fn();
	const effective = resolveEffectiveMode({ requested, expiresAt: options.expiresAt ?? null, caps, now: NOW });
	render(
		<AiModeSwitcher
			capabilities={caps}
			requested={requested ?? "ASSISTED"}
			effective={effective}
			hostingEnabled={options.hostingEnabled ?? true}
			onRequestMode={onRequestMode}
		/>,
	);
	return { onRequestMode };
}

describe("AiModeSwitcher", () => {
	it("offers all four modes and marks the chosen one", () => {
		const { onRequestMode } = renderSwitcher(allModes, "AUTO");
		const group = screen.getByRole("group", { name: "AI 工作模式" });
		const buttons = Array.from(group.querySelectorAll("button"));
		expect(buttons.map((button) => button.textContent)).toEqual(["计划", "确认", "自动", "全自动"]);
		expect(screen.getByRole("button", { name: "自动" })).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(screen.getByRole("button", { name: "全自动" }));
		expect(onRequestMode).toHaveBeenCalledWith("FULL_AUTO");
		// The hint says what the mode in effect does.
		expect(screen.getByText("低、中风险的命令自动执行；高风险和严重命令仍会先询问你。")).toBeInTheDocument();
	});

	it("keeps modes beyond the account's permissions visible, locked, with the reason", () => {
		renderSwitcher({ ...allModes, canAuto: false, canFullAuto: false });
		const auto = screen.getByRole("button", { name: "自动（不可用）" });
		expect(auto).toHaveAttribute("aria-disabled", "true");
		expect(auto).toHaveAttribute("title", "你的账号缺少此模式所需的权限：ai:action:auto + command:execute。");
		fireEvent.focus(auto);
		expect(screen.getByText("你的账号缺少此模式所需的权限：ai:action:auto + command:execute。", { selector: "p" })).toBeInTheDocument();
	});

	it("names the platform ceiling as the reason a mode is locked", () => {
		renderSwitcher({ ...allModes, aiMaxAutomationMode: "auto" });
		expect(screen.getByRole("button", { name: "全自动（不可用）" })).toHaveAttribute("title", "平台允许的最高模式是“自动”，暂时不能选择此模式。");
		expect(screen.getByRole("button", { name: "自动" })).not.toHaveAttribute("aria-disabled");
	});

	it("shows the mode in effect when the chosen one is downgraded", () => {
		renderSwitcher({ ...allModes, aiMaxAutomationMode: "confirm" }, "AUTO");
		expect(screen.getByText("实际生效：确认（受平台上限限制）")).toBeInTheDocument();
	});

	it("says so when the Full auto window ended", () => {
		renderSwitcher(allModes, "FULL_AUTO", { expiresAt: "2026-11-28T09:00:00.000Z" });
		expect(screen.getByText("实际生效：确认（全自动时限已到）")).toBeInTheDocument();
	});

	it("selects nothing and explains itself while the server tools are off", () => {
		renderSwitcher(allModes, "ASSISTED", { hostingEnabled: false });
		expect(screen.getByRole("group", { name: "AI 工作模式" }).querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
		expect(screen.getByText("服务器工具尚未开启。选择一个模式，即可让 AI 在服务器上工作。")).toBeInTheDocument();
	});

	it("warns that automatic modes still ask when the platform requires approval for every AI command", () => {
		renderSwitcher({ ...allModes, aiCommandPolicy: "always" }, "AUTO");
		expect(screen.getByText("平台要求 AI 的每条命令都经过审批，自动模式也会先询问你。")).toBeInTheDocument();
	});
});

describe("AiFullAutoDialog", () => {
	it("offers the windows the platform allows and confirms the chosen one", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(
			<AiFullAutoDialog open busy={false} maxTtlMinutes={30} defaultTtlMinutes={30} allowCritical={false} pinnedServerCount={2} onCancel={onCancel} onConfirm={onConfirm} />,
		);
		const dialog = screen.getByRole("alertdialog", { name: "开启全自动模式？" });
		expect(dialog).toHaveTextContent("严重命令仍需你确认，黑名单命令永远不会自动执行。");
		expect(dialog).toHaveTextContent("已固定 2 台服务器：只会在这些服务器上自动执行。");
		const durations = screen.getByRole("group", { name: "持续时间" });
		expect(Array.from(durations.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["15 分钟", "30 分钟"]);
		fireEvent.click(screen.getByRole("button", { name: "15 分钟" }));
		fireEvent.click(screen.getByRole("button", { name: "开启 15 分钟" }));
		expect(onConfirm).toHaveBeenCalledWith(15);
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		expect(onCancel).toHaveBeenCalled();
	});

	it("warns when no server is pinned", () => {
		render(<AiFullAutoDialog open busy={false} maxTtlMinutes={60} defaultTtlMinutes={30} allowCritical pinnedServerCount={0} onCancel={vi.fn()} onConfirm={vi.fn()} />);
		expect(screen.getByText("未固定服务器：AI 可以在你有权限的任意服务器上自动执行命令。")).toBeInTheDocument();
		expect(screen.getByText("平台允许全自动执行严重命令，黑名单命令永远不会自动执行。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "30 分钟" })).toHaveAttribute("aria-pressed", "true");
	});
});

describe("AiChatHeader working mode status", () => {
	const conversation: ConvItem = {
		id: "conv-1", title: "排障", providerId: "p", model: "gpt-4o", systemPrompt: null, temperature: 0.7, maxTokens: 4096,
		topP: 1, frequencyPenalty: 0, presencePenalty: 0, enableVision: false, hostingEnabled: true, automationMode: "FULL_AUTO",
		createdBy: "u", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", provider: null,
	};
	const controller = (expiresAt: string, overrides: Partial<AutomationModeController> = {}): AutomationModeController => ({
		requested: "FULL_AUTO",
		effective: resolveEffectiveMode({ requested: "FULL_AUTO", expiresAt, caps: allModes, now: NOW }),
		hostingEnabled: true,
		busy: false,
		fullAutoDialogOpen: false,
		requestMode: vi.fn(),
		confirmFullAuto: vi.fn(),
		closeFullAutoDialog: vi.fn(),
		dropToConfirm: vi.fn(),
		cycleMode: vi.fn(() => false),
		defaultTtlMinutes: 30,
		...overrides,
	});
	const renderHeader = (automation: AutomationModeController) => render(
		<AiChatHeader
			activeConv={conversation}
			activeProvider={null}
			currentModelCaps={{ vision: false, document: false, video: false, audio: false }}
			onToggleSidebar={vi.fn()}
			onToggleSettings={vi.fn()}
			onClearMessages={vi.fn()}
			onRenameConv={vi.fn()}
			onExportConv={vi.fn()}
			automation={automation}
		/>,
	);

	it("ticks the time left and drops back to Confirm in one click", () => {
		const automation = controller("2026-11-28T10:12:34.000Z");
		renderHeader(automation);
		expect(screen.getByRole("timer", { name: "全自动模式还剩 12:34" })).toHaveTextContent("全自动 · 剩余 12:34");
		fireEvent.click(screen.getByRole("button", { name: "退回确认模式" }));
		expect(automation.dropToConfirm).toHaveBeenCalledOnce();
	});

	it("says the window ended and offers to turn it on again", () => {
		const automation = controller("2026-11-28T09:59:00.000Z");
		renderHeader(automation);
		expect(screen.queryByRole("timer")).not.toBeInTheDocument();
		expect(screen.getByText("全自动已到期，AI 会重新在每项变更前询问你。")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重新开启" }));
		expect(automation.requestMode).toHaveBeenCalledWith("FULL_AUTO");
	});
});
