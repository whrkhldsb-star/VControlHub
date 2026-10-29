import { createRef } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiMessageList } from "../ai-message-list";

/**
 * A model that thinks before it answers streams reasoning first. With
 * reasoning and no answer text yet, the reply bubble needed text and the
 * waiting hint needed no reasoning: the thinking was hidden, and so was the hint.
 */
describe("AiMessageList while streaming", () => {
	const base = {
		messages: [],
		pendingApprovals: [],
		approvalBusyById: {},
		onApproval: vi.fn(),
		copyFeedback: null,
		setCopyFeedback: vi.fn(),
		currentModelCaps: {} as never,
		messagesEndRef: createRef<HTMLDivElement>(),
		onDrop: vi.fn(),
		onDragOver: vi.fn(),
	};

	it("shows the reasoning before any answer text arrives", () => {
		render(<AiMessageList {...base} streaming streamContent="" streamReasoning="Checking the disk first." />);
		expect(screen.getByText("Checking the disk first.")).toBeVisible();
	});

	it("shows the waiting hint while nothing has arrived", () => {
		render(<AiMessageList {...base} streaming streamContent="" streamReasoning="" />);
		expect(screen.getByText(/思考|Thinking/)).toBeInTheDocument();
	});

	it("shows what the pending actions will run, not only their names", () => {
		// The card gave a name, a risk and a raw server id: a command, a file's new content or a playbook was approved unseen.
		const approval = (actionId: string, actionType: string, params: Record<string, unknown>) => ({
			toolCallId: `call-${actionId}`,
			actionId,
			actionName: actionType,
			actionType,
			riskLevel: "high",
			params,
		});
		render(
			<AiMessageList
				{...base}
				streaming={false}
				streamContent=""
				streamReasoning=""
				pendingApprovals={[
					approval("a1", "execute_command", { serverId: "srv", command: "rm -rf /var/cache/app", reason: "free disk" }),
					approval("a2", "modify_config", { configPath: "/etc/nginx/nginx.conf", content: "worker_processes 8;" }),
					approval("a3", "deploy_docker", { imageName: "redis:7", containerName: "cache", envVars: JSON.stringify({ REDIS_PASSWORD: "s3cret" }) }),
					approval("a4", "run_playbook", { playbookName: "Nightly cleanup" }),
					approval("a5", "manage_cron", { taskId: "task-1", action: "pause" }),
				]}
			/>,
		);
		expect(screen.getByText("rm -rf /var/cache/app")).toBeInTheDocument();
		expect(screen.getByText("free disk")).toBeInTheDocument();
		expect(screen.getByText("/etc/nginx/nginx.conf")).toBeInTheDocument();
		expect(screen.getByText("worker_processes 8;")).toBeInTheDocument();
		expect(screen.getByText("redis:7")).toBeInTheDocument();
		expect(screen.getByText("Nightly cleanup")).toBeInTheDocument();
		expect(screen.getByText("pause")).toBeInTheDocument();
		// Variable names are shown for a container, their values are not.
		expect(screen.getByText("REDIS_PASSWORD")).toBeInTheDocument();
		expect(screen.queryByText(/s3cret/)).not.toBeInTheDocument();
	});
});
