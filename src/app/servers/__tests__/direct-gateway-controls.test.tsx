import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ServerCreateForm } from "../server-create-form";
import { ServerCardActions } from "../server-card-actions";

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useActionState: (action: unknown, initialState: unknown) => [initialState, action, false],
	};
});

vi.mock("@/components/submit-button", () => ({
	SubmitButton: ({ children, className }: { children: React.ReactNode; className?: string }) => (
		<button type="submit" className={className}>{children}</button>
	),
}));

vi.mock("@/components/ssh-terminal-modal", () => ({
	SshTerminalModal: () => <div data-testid="ssh-terminal-modal" />,
}));

describe("server direct gateway controls", () => {
	it("lets users choose global target direct access while adding a server, defaulting to website relay", () => {
		render(<ServerCreateForm sshKeys={[{ id: "key_1", name: "root key", fingerprint: "SHA256:abc", description: null }]} />);

		const checkbox = screen.getByRole("checkbox", { name: /启用目标服务器直连/ });
		expect(checkbox).not.toBeChecked();
		expect(checkbox).toHaveAttribute("name", "enableDirectGateway");
		expect(screen.getByText(/默认使用网站服务器中转/)).toBeInTheDocument();
		expect(screen.getByLabelText("用户名")).toHaveValue("root");
	});

	it("shows a precise switch to install the direct gateway when currently using website relay", () => {
		render(
			<ServerCardActions
				serverId="srv_1"
				serverName="prod"
				host="203.0.113.10"
				port={22}
				enabled={true}
				sessionToken="token"
				canManageServers
				directGateway={{ enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 }}
			/>,
		);

		expect(screen.getByText("直连状态：网站中转")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "启用目标直连" })).toBeInTheDocument();
		expect(document.querySelector('input[name="enabledDirectGateway"]')).toHaveAttribute("value", "true");
	});

	it("shows a precise switch to uninstall the direct gateway when direct access is enabled", () => {
		render(
			<ServerCardActions
				serverId="srv_1"
				serverName="prod"
				host="203.0.113.10"
				port={22}
				enabled={true}
				sessionToken="token"
				canManageServers
				directGateway={{ enabled: true, statusLabel: "目标直连", publicUrl: "http://203.0.113.10:31888", port: 31888 }}
			/>,
		);

		expect(screen.getByText("直连状态：目标直连")).toBeInTheDocument();
		expect(screen.getByText("http://203.0.113.10:31888")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "切回网站中转并删除直连服务" })).toBeInTheDocument();
		expect(document.querySelector('input[name="enabledDirectGateway"]')).toHaveAttribute("value", "false");
	});
});
