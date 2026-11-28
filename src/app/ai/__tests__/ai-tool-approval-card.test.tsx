import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { type AiCapabilities, DEFAULT_AI_CAPABILITIES } from "../ai-automation-mode";
import { AiToolApprovalCard } from "../ai-tool-approval-card";
import type { ToolApprovalNeeded } from "../ai-types";

const command = (overrides: Partial<ToolApprovalNeeded> = {}): ToolApprovalNeeded => ({
	toolCallId: "tc-1",
	actionId: "act-1",
	actionName: "Execute command",
	actionType: "execute_command",
	riskLevel: "high",
	params: { serverId: "srv-1", command: "systemctl restart nginx", reason: "reload config" },
	server: { name: "web-1", host: "10.0.0.1" },
	...overrides,
});

const runsNow: AiCapabilities = { ...DEFAULT_AI_CAPABILITIES, canExecute: true, aiCommandPolicy: "never" };

describe("AiToolApprovalCard", () => {
	it("shows the risk the server assigned, why, and the target server by name", () => {
		render(<AiToolApprovalCard approval={command({ effectiveRisk: "high", riskReasons: ["high.service_mutation", "elevated.sudo", "x.unknown"] })} busy={false} onDecide={vi.fn()} />);
		expect(screen.getByText("高风险")).toBeInTheDocument();
		expect(screen.getByText("服务器：web-1（10.0.0.1）")).toBeInTheDocument();
		expect(screen.getByText("风险依据")).toBeInTheDocument();
		expect(screen.getByText("更改系统服务。")).toBeInTheDocument();
		expect(screen.getByText("使用提升的权限。")).toBeInTheDocument();
		// A code the dictionary does not know is shown as it is, not dropped.
		expect(screen.getByText("x.unknown")).toBeInTheDocument();
		expect(screen.getByText("systemctl restart nginx")).toBeInTheDocument();
	});

	it("sends the edited command when it was changed, and can go back to the original", () => {
		const onDecide = vi.fn();
		render(<AiToolApprovalCard approval={command()} busy={false} capabilities={runsNow} onDecide={onDecide} />);
		fireEvent.click(screen.getByRole("button", { name: "编辑命令" }));
		const editor = screen.getByRole("textbox", { name: "执行前编辑命令" });
		fireEvent.change(editor, { target: { value: "systemctl reload nginx" } });
		expect(screen.getByText("已修改")).toBeInTheDocument();
		expect(screen.getByText("确认时会重新评估修改后命令的风险。")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "确认并执行" }));
		expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ actionId: "act-1" }), "confirm", { editedCommand: "systemctl reload nginx" });

		fireEvent.click(screen.getByRole("button", { name: "恢复原命令" }));
		expect(screen.queryByRole("textbox", { name: "执行前编辑命令" })).not.toBeInTheDocument();
		expect(screen.getByText("systemctl restart nginx")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "确认并执行" }));
		// Unchanged: confirmed as proposed, without an editedCommand.
		expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ actionId: "act-1" }), "confirm", undefined);
	});

	it("refuses to confirm an emptied command", () => {
		render(<AiToolApprovalCard approval={command()} busy={false} capabilities={runsNow} onDecide={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "编辑命令" }));
		fireEvent.change(screen.getByRole("textbox", { name: "执行前编辑命令" }), { target: { value: "   " } });
		expect(screen.getByText("命令不能为空")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
	});

	it("needs the explicit acknowledgement before a critical command can be confirmed", () => {
		const onDecide = vi.fn();
		render(
			<AiToolApprovalCard
				approval={command({ riskLevel: "critical", effectiveRisk: "critical", denylisted: true, riskReasons: ["critical.destructive_rm_root"], params: { command: "rm -rf /" } })}
				busy={false}
				capabilities={{ ...runsNow, isPlatformAdmin: true }}
				onDecide={onDecide}
			/>,
		);
		expect(screen.getByText("黑名单命令")).toBeInTheDocument();
		expect(screen.getByText("递归删除关键目录。")).toBeInTheDocument();
		const confirm = screen.getByRole("button", { name: "确认并执行" });
		expect(confirm).toBeDisabled();
		fireEvent.click(screen.getByRole("checkbox", { name: /我已了解这是严重风险命令/ }));
		expect(confirm).toBeEnabled();
		fireEvent.click(confirm);
		expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ actionId: "act-1" }), "confirm", { acknowledgeCritical: true });
		// Rejecting never needs it.
		fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
		expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ actionId: "act-1" }), "reject");
	});

	it("says whether confirming runs now or files a request for another reviewer", () => {
		const { unmount } = render(<AiToolApprovalCard approval={command({ willExecuteInline: true })} busy={false} onDecide={vi.fn()} />);
		expect(screen.getByRole("button", { name: "确认并执行" })).toBeInTheDocument();
		expect(screen.getByText("确认后立即在服务器上执行，并在这里显示实时输出。")).toBeInTheDocument();
		unmount();

		// The stream's answer wins over the prediction.
		const review = render(<AiToolApprovalCard approval={command({ willExecuteInline: false })} busy={false} capabilities={runsNow} onDecide={vi.fn()} />);
		expect(screen.getByRole("button", { name: "确认创建请求" })).toBeInTheDocument();
		expect(screen.getByText("确认后会创建命令申请，由另一位审批人批准后才执行。")).toBeInTheDocument();
		review.unmount();

		// A card restored from history predicts it from the account's capabilities.
		render(<AiToolApprovalCard approval={command()} busy={false} capabilities={runsNow} onDecide={vi.fn()} />);
		expect(screen.getByRole("button", { name: "确认并执行" })).toBeInTheDocument();
	});

	it("keeps Confirm for lasting automation, which never runs a command by itself", () => {
		render(<AiToolApprovalCard approval={command({ actionType: "manage_cron", actionName: "Manage cron", params: { taskId: "task-1", action: "pause" } })} busy={false} capabilities={runsNow} onDecide={vi.fn()} />);
		expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "编辑命令" })).not.toBeInTheDocument();
	});

	it("disables both decisions while one is being sent", () => {
		render(<AiToolApprovalCard approval={command()} busy capabilities={runsNow} onDecide={vi.fn()} />);
		expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
	});

	it("reclassifies edited commands live and clears critical acknowledgement on subsequent edits (Astra P1-8)", () => {
		const onDecide = vi.fn();
		render(
			<AiToolApprovalCard
				approval={command({ riskLevel: "low", effectiveRisk: "low", params: { serverId: "srv-1", command: "uptime" } })}
				busy={false}
				capabilities={{ ...runsNow, isPlatformAdmin: true }}
				onDecide={onDecide}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "编辑命令" }));
		const editor = screen.getByRole("textbox", { name: "执行前编辑命令" });
		// Escalating to a destructive command requires explicit critical acknowledgement.
		fireEvent.change(editor, { target: { value: "rm -rf /" } });
		const confirm = screen.getByRole("button", { name: "确认并执行" });
		expect(confirm).toBeDisabled();
		const checkbox = screen.getByRole("checkbox", { name: /我已了解这是严重风险命令/ });
		fireEvent.click(checkbox);
		expect(confirm).toBeEnabled();
		// Editing again resets the acknowledgement so the user must re-confirm the new command.
		fireEvent.change(editor, { target: { value: "rm -rf /etc" } });
		expect(confirm).toBeDisabled();
		fireEvent.click(screen.getByRole("checkbox", { name: /我已了解这是严重风险命令/ }));
		fireEvent.click(confirm);
		expect(onDecide).toHaveBeenCalledWith(
			expect.objectContaining({ actionId: "act-1" }),
			"confirm",
			{ editedCommand: "rm -rf /etc", acknowledgeCritical: true },
		);
	});
});
