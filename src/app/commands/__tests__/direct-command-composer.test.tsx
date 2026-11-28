import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { api } from "@/lib/http/api-client";
import { DirectCommandComposer, type ComposerProps } from "../direct-command-composer";

vi.mock("@/lib/http/api-client", () => ({ api: { post: vi.fn() } }));
const servers = [{ id: "a", name: "Alpha", host: "a.local" }, { id: "b", name: "Beta", host: "b.local" }, { id: "c", name: "Offline", host: "c.local", available: false }];
const command = vi.fn();
const template = vi.fn();
function mount(props: Partial<ComposerProps> = {}) {
	return renderWithI18n(<DirectCommandComposer servers={servers} allowDirectExecution initial={{ command: "uptime", serverIds: ["a", "c", "out-of-scope"] }} {...props} />, { locale: "en" });
}
beforeEach(() => {
	command.mockReset().mockResolvedValue({ command: { id: "cmd/1", status: "PENDING_APPROVAL", riskLevel: "high", targets: [{}] } });
	template.mockReset();
	vi.mocked(api.post).mockReset().mockImplementation(async (url, body) => {
		if (url === "/api/commands") return command(body);
		if (url === "/api/command-templates") return template(body);
		if (url !== "/api/commands/preview") throw Error(url);
		return { preview: { riskLevel: "low", riskReasons: ["low.readonly_inspect"], denylisted: false, requiresApproval: !!(body as { approvalRequired?: boolean }).approvalRequired } };
	});
});

it("preselects only available targets, confirms multi-server dispatch and uses the server receipt", async () => {
	mount({ canReadRequests: true, canReadTasks: true });
	expect(screen.getByLabelText(/Alpha/)).toBeChecked();
	expect(screen.getByLabelText(/Offline/)).not.toBeChecked();
	fireEvent.click(screen.getByLabelText(/Beta/));
	expect(await screen.findByText("Inspects system state without changing it.")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Confirm and run now" }));
	const dialog = screen.getByRole("dialog");
	expect(dialog).toHaveTextContent("Beta"); expect(command).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "Run command" }));
	expect(await screen.findByText("PENDING_APPROVAL")).toBeVisible();
	expect(screen.getByText("Targets: 1")).toBeVisible(); expect(screen.getByText("High")).toBeVisible();
	expect(command.mock.calls[0]![0]).toMatchObject({ title: "uptime", serverIds: ["a", "b"] });
	expect(command.mock.calls[0]![0]).not.toHaveProperty("approvalRequired");
	expect(screen.getByRole("link", { name: "View request details" })).toHaveAttribute("href", "/requests?requestId=cmd%2F1");
	expect(screen.getByRole("link", { name: "View operation tasks" })).toHaveAttribute("href", "/operation-tasks");
	expect(template).not.toHaveBeenCalled();
});

it.each([false, true])("requires peer review when forced or explicitly selected (executor=%s)", async executor => {
	mount({ allowDirectExecution: executor });
	const peer = screen.queryByLabelText("Request peer review");
	if (executor) fireEvent.click(peer!); else expect(peer).toBeNull();
	expect(await screen.findByText("Will queue for approval")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
	expect(command).toHaveBeenCalledWith(expect.objectContaining({ approvalRequired: true }));
	await screen.findByText("Command receipt"); expect(screen.queryByRole("link")).toBeNull();
});

it("saves a template independently and never redispatches when retrying", async () => {
	template.mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce({ template: {} });
	mount({ allowDirectExecution: false });
	expect(screen.getByLabelText("Save as template")).not.toBeChecked();
	fireEvent.click(screen.getByLabelText("Save as template"));
	fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Inspect uptime" } });
	await screen.findByText("Will queue for approval");
	fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
	fireEvent.click(await screen.findByRole("button", { name: "Retry save template" }));
	await screen.findByText("Template saved."); expect(command).toHaveBeenCalledTimes(1); expect(template).toHaveBeenCalledTimes(2);
	expect(template.mock.calls[0]).toEqual(template.mock.calls[1]);
});

it("does not dispatch against an old preview after the command changes", async () => {
	mount(); await screen.findByText("Low");
	vi.mocked(api.post).mockRejectedValue(Error("offline"));
	fireEvent.change(screen.getByLabelText("Command"), { target: { value: "whoami" } });
	expect(screen.getByRole("button", { name: "Confirm and run now" })).toBeDisabled();
	expect(await screen.findByText(/Could not check/)).toBeVisible();
	expect(command).not.toHaveBeenCalled();
});
