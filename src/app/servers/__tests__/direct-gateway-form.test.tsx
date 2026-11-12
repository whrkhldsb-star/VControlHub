import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const action = vi.hoisted(() => ({ toggleDirectGatewayAction: vi.fn() }));
vi.mock("../actions", () => action);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ServerCardDirectGatewayForm } from "../server-card-actions-direct-gateway";

describe("ServerCardDirectGatewayForm", () => {
	it("keeps the protocol and the domain when the gateway could not be installed", async () => {
		// The answer comes after a remote installation; a refusal emptied the domain that had been typed.
		action.toggleDirectGatewayAction.mockImplementation(async () => ({ error: "域名尚未解析到该服务器" }));
		renderWithI18n(<ServerCardDirectGatewayForm serverId="srv_1" directGateway={{ enabled: false, publicUrl: null, port: 0 }} />);
		fireEvent.change(screen.getByLabelText("直连公网协议"), { target: { value: "https" } });
		fireEvent.change(screen.getByLabelText("HTTPS 公网域名（可选）"), { target: { value: "direct.example.com" } });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "启用目标直连" }));
		});
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

		expect(await screen.findByText("域名尚未解析到该服务器")).toBeInTheDocument();
		expect(screen.getByLabelText("直连公网协议")).toHaveValue("https");
		expect(screen.getByLabelText("HTTPS 公网域名（可选）")).toHaveValue("direct.example.com");
	});
});
