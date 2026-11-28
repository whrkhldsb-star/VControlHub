import { createRef } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiLiveActionPanel } from "../ai-live-action-panel";
import { AiMessageList } from "../ai-message-list";
import type { HostedActionLive, HostedActionLiveTarget, Message, StreamStep } from "../ai-types";
import type { TrackedAction } from "../hooks/use-hosted-action-tracker";

const live = (status: HostedActionLive["action"]["status"], target: Partial<HostedActionLiveTarget> = {}): HostedActionLive => ({
	action: { id: "act-1", status, commandRequestId: "cmd-1" },
	command: {
		id: "cmd-1",
		status: status === "EXECUTING" ? "RUNNING" : status,
		command: "df -h",
		origin: "AI_CHAT",
		riskLevel: "low",
		decisionSource: "REQUESTER_CONFIRMED",
		targets: [{
			id: "t-1", serverId: "srv-1", serverName: "web-1", status: status === "EXECUTING" ? "RUNNING" : status,
			exitCode: null, outcomeUnknown: false, stdout: "Filesystem  Size\n/dev/sda1   40G", stderr: null, finishedAt: null,
			...target,
		}],
	},
});

const tracked = (overrides: Partial<TrackedAction> = {}): TrackedAction => ({
	actionId: "act-1",
	conversationId: "conv-1",
	phase: "running",
	status: "EXECUTING",
	commandRequestId: "cmd-1",
	autoContinue: true,
	live: live("EXECUTING"),
	pollFailed: false,
	cancel: "idle",
	...overrides,
});

describe("AiLiveActionPanel", () => {
	it("shows a running command's target, masked output and a Cancel button", () => {
		const onCancel = vi.fn();
		render(<AiLiveActionPanel action={tracked()} canCancel onCancel={onCancel} />);
		const panel = screen.getByRole("region", { name: "执行进度" });
		expect(panel).toHaveTextContent("正在执行");
		expect(panel).toHaveTextContent("df -h");
		expect(panel).toHaveTextContent("web-1");
		expect(panel).toHaveTextContent("/dev/sda1 40G");
		// How the command was let through.
		expect(panel).toHaveTextContent("申请人确认");
		expect(screen.getByRole("link", { name: "查看命令申请" })).toHaveAttribute("href", "/requests?requestId=cmd-1");
		fireEvent.click(screen.getByRole("button", { name: "取消执行" }));
		expect(onCancel).toHaveBeenCalledWith("act-1");
	});

	it("shows the exit code once the command finished, without a Cancel button", () => {
		render(<AiLiveActionPanel action={tracked({ phase: "settled", status: "FAILED", live: live("FAILED", { exitCode: 2, stderr: "permission denied" }) })} canCancel onCancel={vi.fn()} />);
		const panel = screen.getByRole("region", { name: "执行进度" });
		expect(panel).toHaveTextContent("执行失败");
		expect(panel).toHaveTextContent("退出码 2");
		expect(panel).toHaveTextContent("permission denied");
		expect(screen.queryByRole("button", { name: "取消执行" })).not.toBeInTheDocument();
	});

	it("says a cancellation is on its way and that a status read failed", () => {
		render(<AiLiveActionPanel action={tracked({ cancel: "requested", pollFailed: true })} canCancel onCancel={vi.fn()} />);
		expect(screen.getByText("已请求取消，等待执行端确认。")).toBeInTheDocument();
		expect(screen.getByText("暂时无法获取执行状态，正在重试…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "正在取消…" })).toBeDisabled();
	});

	it("is a receipt for a command sent to peer review: not run, with the link to its request", () => {
		const onCancel = vi.fn();
		render(<AiLiveActionPanel action={tracked({ phase: "review", status: "APPROVED", live: null })} canCancel onCancel={onCancel} />);
		expect(screen.getByText("已提交同行审批")).toBeInTheDocument();
		expect(screen.getByText("这条命令还没有执行：需要另一位审批人批准后才会运行。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "查看命令申请" })).toHaveAttribute("href", "/requests?requestId=cmd-1");
		expect(screen.queryByText(/正在执行/)).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
		expect(onCancel).toHaveBeenCalledWith("act-1");
	});
});

describe("AiMessageList with followed actions", () => {
	const base = {
		streaming: false,
		streamContent: "",
		streamReasoning: "",
		pendingApprovals: [],
		approvalBusyById: {},
		onApproval: vi.fn(),
		currentModelCaps: {} as never,
		messagesEndRef: createRef<HTMLDivElement>(),
		onDrop: vi.fn(),
		onDragOver: vi.fn(),
	};
	const message = (status: string, extra: Record<string, unknown> = {}): Message => ({
		id: "msg-1", conversationId: "conv-1", role: "assistant", content: "我来重启服务。", reasoningContent: null, imageUrls: "[]",
		model: "m", inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-28T00:00:00.000Z",
		hostedActions: [{
			id: "act-1", conversationId: "conv-1", messageId: "msg-1", toolCallId: "tc-1", serverId: "srv-1", actionType: "execute_command",
			actionName: "Execute command", params: "{}", status: status as never, riskLevel: "medium", effectiveRisk: "high",
			autoApproved: false, result: null, errorMessage: null, createdAt: "2026-11-28T00:00:00.000Z", approvedAt: null,
			executedAt: null, completedAt: null, server: { id: "srv-1", name: "web-1", host: "10.0.0.1" }, ...extra,
		}],
	});

	it("draws the live run under the transcript entry it belongs to", () => {
		render(<AiMessageList {...base} messages={[message("EXECUTING", { decisionSource: "REQUESTER_CONFIRMED" })]} trackedActions={{ "act-1": tracked() }} capabilities={{ canExecute: true } as never} onCancelAction={vi.fn()} />);
		const entry = document.querySelector('[data-hosted-action="act-1"]')!;
		// The risk shown is the server's re-assessment of the final command.
		expect(entry).toHaveTextContent("风险：高");
		expect(entry).toHaveTextContent("申请人确认");
		expect(entry.querySelector('[data-live-action="running"]')).not.toBeNull();
	});

	it("offers to continue the answer once the actions settled", () => {
		const continueNow = vi.fn();
		render(
			<AiMessageList
				{...base}
				messages={[message("COMPLETED")]}
				continuation={{ state: "available", limitReached: false, continueNow, pause: vi.fn(), resetAutoBudget: vi.fn() }}
			/>,
		);
		expect(screen.getByText("操作已经有结果，可以让 AI 查看输出并继续回答。")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "继续 AI 回答" }));
		expect(continueNow).toHaveBeenCalledOnce();
	});

	it("continues by itself after a pause it can be stopped in", () => {
		const pause = vi.fn();
		const continueNow = vi.fn();
		render(<AiMessageList {...base} messages={[message("COMPLETED")]} continuation={{ state: "auto", limitReached: false, continueNow, pause, resetAutoBudget: vi.fn() }} />);
		expect(screen.getByText("AI 即将读取执行结果并继续回答…")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "暂停" }));
		expect(pause).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: "立即继续" }));
		expect(continueNow).toHaveBeenCalledOnce();
	});

	it("hides the continuation while an answer streams", () => {
		render(<AiMessageList {...base} streaming messages={[message("COMPLETED")]} continuation={{ state: "available", limitReached: false, continueNow: vi.fn(), pause: vi.fn(), resetAutoBudget: vi.fn() }} />);
		expect(screen.queryByRole("button", { name: "继续 AI 回答" })).not.toBeInTheDocument();
	});

	it("shows what each call returned in the live timeline, and the live output of an automatic run", () => {
		const steps: StreamStep[] = [
			{ toolCallId: "c1", actionType: "list_servers", name: "List servers", state: "succeeded", resultCount: 3, output: "[{\"name\":\"web-1\"}]" },
			{ toolCallId: "c2", actionType: "execute_command", name: "Execute command", state: "failed", exitCode: 1, error: "No such file" },
			{ toolCallId: "c3", actionType: "execute_command", name: "Execute command", state: "running", auto: true, phase: "running", riskLevel: "medium", actionId: "act-1" },
			{ toolCallId: "c4", actionType: "restart_service", name: "Restart service", state: "running", auto: true, phase: "timeout", riskLevel: "high" },
		];
		render(<AiMessageList {...base} messages={[]} streaming streamSteps={steps} trackedActions={{ "act-1": tracked() }} capabilities={{ canExecute: true } as never} />);
		const list = screen.getByRole("list", { name: "这次回答执行的操作" });
		const rows = Array.from(list.querySelectorAll(":scope > li"));
		expect(rows[0]).toHaveTextContent("已执行：列出可管理 VPS");
		expect(rows[0]).toHaveTextContent("3 条结果");
		expect(rows[0]!.querySelector("details")).toHaveTextContent("查看输出");
		expect(rows[1]).toHaveTextContent("执行失败：执行命令");
		expect(rows[1]).toHaveTextContent("退出码 1");
		expect(rows[1]).toHaveTextContent("No such file");
		expect(rows[2]).toHaveTextContent("自动执行：执行命令…");
		expect(rows[2]).toHaveTextContent("自动执行");
		expect(rows[2]).toHaveTextContent("中风险");
		expect(rows[2]).toHaveTextContent("/dev/sda1 40G");
		expect(rows[3]).toHaveTextContent("仍在后台执行：重启服务");
		expect(rows[3]).toHaveTextContent("高风险");
	});
});
