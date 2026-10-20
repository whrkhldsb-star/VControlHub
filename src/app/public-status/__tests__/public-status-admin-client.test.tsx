import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/toast-provider";
import { I18nProvider } from "@/lib/i18n/provider";
import { DEFAULT_PUBLIC_SITE } from "@/lib/public-status/site-config";
import { PublicStatusAdminClient } from "../public-status-admin-client";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/http/api-client", async (original) => ({
	...await original<typeof import("@/lib/http/api-client")>(),
	api,
}));

const ROW = {
	serverId: "srv_1",
	serverName: "internal-db-01",
	customerName: "Acme",
	enabled: true,
	managementMode: "DIRECT" as const,
	publication: null,
	lastSampleAt: null,
};

function renderAdmin() {
	return render(
		<I18nProvider initialLocale="en">
			<ToastProvider>
				<PublicStatusAdminClient initialSite={{ ...DEFAULT_PUBLIC_SITE, metrics: ["cpu", "memory"] }} />
			</ToastProvider>
		</I18nProvider>,
	);
}

describe("PublicStatusAdminClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.get.mockResolvedValue({ total: 1, rows: [ROW], page: 1, pageSize: 25 });
		api.put.mockResolvedValue({ site: { ...DEFAULT_PUBLIC_SITE, enabled: true } });
		api.post.mockResolvedValue({ changed: 1, skipped: [] });
	});

	it("starts private and needs a public name before saving; the preview lists what visitors get", async () => {
		const user = userEvent.setup();
		renderAdmin();
		const row = await screen.findByText("internal-db-01");
		expect(screen.getByText("Private")).toBeInTheDocument();
		await user.click(within(row.closest("tr")!).getByRole("button", { name: "Public settings" }));
		const dialog = await screen.findByRole("dialog");
		const name = within(dialog).getByLabelText("Public name");
		// Never prefilled from the internal server name.
		expect(name).toHaveValue("");
		const save = within(dialog).getByRole("button", { name: "Save" });
		expect(save).toBeDisabled();
		expect(within(dialog).getByText("missing (required)")).toBeInTheDocument();
		await user.type(name, "Tokyo 1");
		await user.type(within(dialog).getByLabelText("Tags"), "prod, ipv6");
		await user.click(within(dialog).getByRole("switch", { name: "Show on the board" }));
		expect(within(dialog).getByText("prod · ipv6")).toBeInTheDocument();
		expect(within(dialog).getByText(/CPU.*Memory/)).toBeInTheDocument();
		expect(within(dialog).getByText(/Never public: host address/)).toBeInTheDocument();
		api.put.mockResolvedValueOnce({ publicId: "abcdefghijkl", published: true });
		await user.click(save);
		await waitFor(() => expect(api.put).toHaveBeenCalledWith("/api/admin/public-status/nodes/srv_1", expect.objectContaining({ displayName: "Tokyo 1", tags: ["prod", "ipv6"], published: true })));
	});

	it("shows a server-side refusal inside the dialog", async () => {
		const user = userEvent.setup();
		renderAdmin();
		const row = await screen.findByText("internal-db-01");
		await user.click(within(row.closest("tr")!).getByRole("button", { name: "Public settings" }));
		const dialog = await screen.findByRole("dialog");
		await user.type(within(dialog).getByLabelText("Public name"), "203.0.113.7");
		api.put.mockRejectedValueOnce(new Error("Public fields must not contain the server's host address"));
		await user.click(within(dialog).getByRole("button", { name: "Save" }));
		expect(await within(dialog).findByRole("alert")).toHaveTextContent("host address");
	});

	it("saves site settings with the chosen categories", async () => {
		const user = userEvent.setup();
		renderAdmin();
		await user.click(screen.getByRole("switch", { name: /Publish the board/ }));
		await user.click(screen.getByLabelText("Monthly traffic"));
		await user.click(screen.getAllByRole("button", { name: "Save" })[0]!);
		await waitFor(() => expect(api.put).toHaveBeenCalledWith("/api/admin/public-status/site", expect.objectContaining({ enabled: true, metrics: ["cpu", "memory", "traffic"] })));
	});

	it("batch actions apply to the selection", async () => {
		const user = userEvent.setup();
		renderAdmin();
		await user.click(await screen.findByRole("checkbox", { name: "Select internal-db-01" }));
		await user.click(screen.getByRole("button", { name: "Unpublish" }));
		await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/admin/public-status/nodes", { action: "unpublish", serverIds: ["srv_1"] }));
	});

	it("keeps a site draft typed while the previous save was pending", async () => {
		// The answer used to replace the form with what was saved, wiping the newer draft.
		const user = userEvent.setup();
		let answer!: (value: unknown) => void;
		api.put.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
		renderAdmin();
		const title = screen.getByLabelText("Title");
		await user.type(title, "Submitted title");
		await user.click(screen.getAllByRole("button", { name: "Save" })[0]!);
		await user.clear(title);
		await user.type(title, "Later unsaved title");
		await act(async () => answer({ site: { ...DEFAULT_PUBLIC_SITE, title: "Submitted title" } }));
		expect(title).toHaveValue("Later unsaved title");
	});

	it("takes the server's normalised copy when nothing was typed meanwhile", async () => {
		const user = userEvent.setup();
		renderAdmin();
		const title = screen.getByLabelText("Title");
		await user.type(title, "  Spaced  ");
		api.put.mockResolvedValueOnce({ site: { ...DEFAULT_PUBLIC_SITE, title: "Spaced" } });
		await user.click(screen.getAllByRole("button", { name: "Save" })[0]!);
		await waitFor(() => expect(title).toHaveValue("Spaced"));
	});

	it("cannot cancel a node dialog while its save is pending", async () => {
		// Cancelling let another node's dialog open, which the late answer then closed.
		const user = userEvent.setup();
		renderAdmin();
		const row = await screen.findByText("internal-db-01");
		await user.click(within(row.closest("tr")!).getByRole("button", { name: "Public settings" }));
		const dialog = await screen.findByRole("dialog");
		await user.type(within(dialog).getByLabelText("Public name"), "Tokyo 1");
		let answer!: (value: unknown) => void;
		api.put.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
		await user.click(within(dialog).getByRole("button", { name: "Save" }));
		expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
		await act(async () => answer({ publicId: "abcdefghijkl", published: false }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	});
});

