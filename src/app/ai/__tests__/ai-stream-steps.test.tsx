import { createRef } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiMessageList } from "../ai-message-list";
import type { StreamStep } from "../ai-types";
import { upsertStreamStep } from "../hooks/use-ai-chat-stream";

/**
 * An answer's tool calls were appended to its streamed text: glued to it ("…先看磁盘。⚡ 执行：View server status…
 * ✅ 操作执行成功"), named in English on a Chinese page, and wiped by the next chunk of text. They are a list of
 * their own now, one row per call, which the call's answer updates.
 */
describe("the answer's tool steps", () => {
	it("adds a call, and updates it when its answer arrives", () => {
		const called = upsertStreamStep([], { toolCallId: "c1", actionType: "get_status", name: "View server status", state: "running", riskLevel: "low" });
		expect(called).toEqual([{ toolCallId: "c1", actionType: "get_status", name: "View server status", state: "running", riskLevel: "low" }]);
		const answered = upsertStreamStep(called, { toolCallId: "c1", state: "succeeded" });
		expect(answered).toEqual([{ toolCallId: "c1", actionType: "get_status", name: "View server status", state: "succeeded", riskLevel: "low" }]);
		expect(called[0]!.state).toBe("running");
	});

	it("keeps an answer to a call it never saw, without a name", () => {
		expect(upsertStreamStep([], { toolCallId: "c9", state: "failed" })).toEqual([{ toolCallId: "c9", name: null, state: "failed" }]);
	});

	const base = {
		messages: [],
		pendingApprovals: [],
		approvalBusyById: {},
		onApproval: vi.fn(),
		currentModelCaps: {} as never,
		messagesEndRef: createRef<HTMLDivElement>(),
		onDrop: vi.fn(),
		onDragOver: vi.fn(),
	};
	const steps: StreamStep[] = [
		{ toolCallId: "c1", actionType: "get_status", name: "View server status", state: "succeeded", riskLevel: "low" },
		{ toolCallId: "c2", actionType: "execute_command", name: "Execute command", state: "running", riskLevel: "medium" },
		{ toolCallId: "c3", actionType: "restart_service", name: "Restart service", state: "awaiting", riskLevel: "high" },
		{ toolCallId: "c4", name: null, state: "failed" },
	];

	it("lists them under the text, in the page's language", () => {
		render(<AiMessageList {...base} streaming streamContent="先看磁盘。" streamReasoning="" streamSteps={steps} />);
		expect(screen.getByText("先看磁盘。")).toBeVisible();
		const list = screen.getByRole("list", { name: "这次回答执行的操作" });
		expect([...list.querySelectorAll("li")].map((item) => [item.dataset.streamStep, item.textContent])).toEqual([
			["succeeded", "已执行：查看服务器状态"],
			["running", "正在执行：执行命令…"],
			["awaiting", "等待审批：重启服务（风险：高）"],
			["failed", "有一个操作没有执行"],
		]);
		expect(list.textContent).not.toMatch(/[⚡✅❌⏳🔒]/u);
	});

	it("shows the steps before any text arrives, instead of the waiting hint", () => {
		render(<AiMessageList {...base} streaming streamContent="" streamReasoning="" streamSteps={steps.slice(0, 1)} />);
		expect(screen.getByText("已执行：查看服务器状态")).toBeVisible();
		expect(screen.queryByText(/思考|Thinking/)).not.toBeInTheDocument();
	});
});
