import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiTokenManagerClient, type SafeApiToken } from "../api-token-manager-client";

// The create form's unsaved-changes guard navigates with the router.
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/api-tokens",
	useSearchParams: () => new URLSearchParams(),
}));

const header = { title: "Personal API token" };

const token = {
	id: "tok_1",
	name: "CLI",
	tokenPrefix: "whr_1234",
	tokenSuffix: "abcdef",
	scopes: ["read", "health:read"],
	expiresAt: null,
	lastUsedAt: null,
	revokedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	teamId: "team_1",
	team: { name: "Ops", slug: "ops" },
};

function page(tokens: SafeApiToken[], total = tokens.length, nextCursor: string | null = null) {
	return { tokens, total, totalTokens: 230, activeTokens: 12, nextCursor };
}

function json(data: unknown, status = 200) {
	return { ok: true, status, json: async () => data };
}

describe("ApiTokenManagerClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("marks a former customer's token as unbound and keeps its revocation available", () => {
		render(<ApiTokenManagerClient initialPage={page([{ ...token, team: null }])} pageSize={1}
			allowedScopes={["read"]} currentCustomerName="Current" />, { locale: "en" });
		expect(screen.getByText("Customer access lost", { selector: "span" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /revoke.*CLI/i })).toBeEnabled();
	});

	it("requests one cursor page at a time and keeps status totals separate from the visible rows", async () => {
		const older = { ...token, id: "tok_2", name: "Older" };
		const first = page([token], 230, token.id);
		const fetchMock = vi.fn().mockResolvedValueOnce(json(page([older], 230))).mockResolvedValueOnce(json(first))
			.mockResolvedValueOnce(json(page([older], 230)))
			.mockResolvedValueOnce(json(page([token], 12))).mockResolvedValueOnce(json(page([], 0)))
			.mockResolvedValueOnce(json(page([{ ...older, revokedAt: older.createdAt }], 218)));
		vi.stubGlobal("fetch", fetchMock);
		render(<ApiTokenManagerClient initialPage={first} pageSize={1} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
		expect(fetchMock).not.toHaveBeenCalled();
		const stat = (label: string) => screen.getByText(label).closest("article");
		expect(stat("Total tokens")).toHaveTextContent("230");
		expect(stat("Currently active")).toHaveTextContent("12");
		const lastQuery = () => Object.fromEntries(new URL(String(fetchMock.mock.lastCall![0]), "http://local").searchParams);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(await screen.findByRole("heading", { name: "Older" })).toBeInTheDocument();
		expect(lastQuery()).toEqual({ status: "all", pageSize: "1", cursor: token.id });
		expect(screen.queryByRole("heading", { name: "CLI" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Previous" }));
		expect(await screen.findByRole("heading", { name: "CLI" })).toBeInTheDocument();
		expect(lastQuery()).toEqual({ status: "all", pageSize: "1" });
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await screen.findByRole("heading", { name: "Older" });

		const filter = screen.getByRole("combobox", { name: "Filter by status" });
		fireEvent.change(filter, { target: { value: "active" } });
		await screen.findByRole("heading", { name: "CLI" });
		expect(lastQuery()).toEqual({ status: "active", pageSize: "1" });
		expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
		fireEvent.change(filter, { target: { value: "expired" } });
		await screen.findByText("No tokens with this status");
		expect(lastQuery()).toEqual({ status: "expired", pageSize: "1" });
		fireEvent.change(filter, { target: { value: "revoked" } });
		await screen.findByRole("heading", { name: "Older" });
		expect(lastQuery()).toEqual({ status: "revoked", pageSize: "1" });
		expect(screen.getByText("218")).toBeInTheDocument();
		expect(stat("Total tokens")).toHaveTextContent("230");
		expect(stat("Currently active")).toHaveTextContent("12");
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it("refreshes the active filter after revocation and retries a failed page read without repeating the write", async () => {
		const active = page([token], 12);
		const fetchMock = vi.fn().mockResolvedValueOnce(json(active))
			.mockResolvedValueOnce(json({ token: { ...token, revokedAt: token.createdAt } }))
			.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Cannot load tokens" }) })
			.mockResolvedValueOnce(json({ ...page([], 0), activeTokens: 0 }));
		vi.stubGlobal("fetch", fetchMock);
		render(<ApiTokenManagerClient initialPage={page([token])} pageSize={25} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
		fireEvent.click(await screen.findByRole("button", { name: "Revoke CLI" }));
		fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
		await screen.findByText("Cannot load tokens");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("No tokens with this status");
		expect(screen.getByText("Currently active").closest("article")).toHaveTextContent("0");
		expect(screen.getByRole("combobox")).toHaveValue("active");
		expect(fetchMock.mock.calls.filter(([, init]) => init.method === "DELETE")).toHaveLength(1);
		expect(fetchMock.mock.lastCall![0]).toContain("status=active");
	});

	it("creates an API token through JSON and shows the plaintext only in the one-time result panel", async () => {
		const created = { ...token, id: "tok_2", name: "mobile", scopes: ["read", "status:read"], tokenSuffix: "n_once" };
		const fetchMock = vi.fn().mockResolvedValueOnce(json({ token: "whr_plain_once", apiToken: created }, 201))
			.mockResolvedValueOnce(json(page([created, token])));
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read", "health:read", "status:read"]} currentCustomerName="Ops" />, { locale: "en" });

		// The form opens from the header; the tokens come first.
		expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Create API token" }));
		fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "mobile" } });
		fireEvent.click(screen.getByLabelText("status:read"));
		fireEvent.click(screen.getByRole("button", { name: "Create token" }));

		await screen.findByText("Copy it now. The plaintext token cannot be retrieved after you leave this page.");
		expect(screen.getByText("whr_plain_once")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith("/api/api-tokens", expect.objectContaining({
			method: "POST",
			body: JSON.stringify({ name: "mobile", scopes: ["read", "status:read"], expiresAt: null }),
		}));
		expect(await screen.findByText("mobile")).toBeInTheDocument();
		// Created: the form closed under the plaintext, and the next token starts from the header again.
		expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create API token" })).toBeInTheDocument();
	});

	it("shows how to call the API with the new token, without the secret in the example", async () => {
		const created = { ...token, id: "tok_2", name: "mobile" };
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ token: "whr_plain_once", apiToken: created }, 201))
			.mockResolvedValueOnce(json(page([created, token]))));
		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Create API token" }));
		fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "mobile" } });
		fireEvent.click(screen.getByRole("button", { name: "Create token" }));
		const example = await screen.findByText(/Authorization: Bearer <TOKEN>/);
		expect(example.textContent).not.toContain("whr_plain_once");
		expect(screen.getByRole("link", { name: "Open API docs" })).toHaveAttribute("href", "/api-docs");
	});

	it("says at the top of the page that a customer must be selected first", () => {
		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read"]} currentCustomerName={null} />, { locale: "en" });
		expect(screen.getByText("No customer selected")).toBeInTheDocument();
		expect(screen.getByText("Select a customer in the sidebar before creating a token.")).toBeInTheDocument();
	});

	it("closes the form on Cancel and says a refusal inside it", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "A token with this name exists" }) }));
		render(<ApiTokenManagerClient header={header} initialPage={{ ...page([]), totalTokens: 0, activeTokens: 0 }} pageSize={25} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
		// The empty list offers the same command as the header.
		expect(screen.getAllByRole("button", { name: "Create API token" })).toHaveLength(2);
		fireEvent.click(screen.getAllByRole("button", { name: "Create API token" })[0]!);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();

		fireEvent.click(screen.getAllByRole("button", { name: "Create API token" })[0]!);
		fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "mobile" } });
		fireEvent.click(screen.getByRole("button", { name: "Create token" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("A token with this name exists");
		expect(screen.getByLabelText("Token name")).toHaveValue("mobile");
	});

	// The plaintext is shown once. Its copy button said nothing either way, and did nothing where the page has no
	// Clipboard API (plain HTTP).
	describe("copying the new token", () => {
		const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		const originalExecCommand = (document as { execCommand?: unknown }).execCommand;
		afterEach(() => {
			if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
			else delete (navigator as { clipboard?: unknown }).clipboard;
			(document as { execCommand?: unknown }).execCommand = originalExecCommand;
		});

		async function createToken() {
			const created = { ...token, id: "tok_2", name: "mobile" };
			vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ token: "whr_plain_once", apiToken: created }, 201))
				.mockResolvedValueOnce(json(page([created, token]))));
			render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
			fireEvent.click(screen.getByRole("button", { name: "Create API token" }));
			fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "mobile" } });
			fireEvent.click(screen.getByRole("button", { name: "Create token" }));
			await screen.findByText("whr_plain_once");
		}

		it("says that the token was copied", async () => {
			await createToken();
			const writeText = vi.fn(async () => undefined);
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

			fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

			expect(await screen.findByText("Copied to the clipboard")).toBeInTheDocument();
			expect(writeText).toHaveBeenCalledWith("whr_plain_once");
		});

		it("copies without the Clipboard API", async () => {
			await createToken();
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
			const copied: string[] = [];
			(document as { execCommand?: unknown }).execCommand = vi.fn(() => {
				const field = document.activeElement;
				if (field instanceof HTMLTextAreaElement) copied.push(field.value);
				return true;
			});

			fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

			expect(await screen.findByText("Copied to the clipboard")).toBeInTheDocument();
			expect(copied).toEqual(["whr_plain_once"]);
		});

		it("says so when the token could not be copied", async () => {
			await createToken();
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
			(document as { execCommand?: unknown }).execCommand = vi.fn(() => false);

			fireEvent.click(screen.getByRole("button", { name: "Copy token" }));

			expect(await screen.findByText("Could not copy. Select the token and copy it by hand.")).toBeInTheDocument();
		});
	});

	it("opens an in-app confirmation dialog before revoking a token", async () => {
		const confirmSpy = vi.spyOn(window, "confirm");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ token: { ...token, revokedAt: "2026-01-02T00:00:00Z" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke CLI" }));

		const dialog = await screen.findByRole("dialog", { name: "Revoke this API token?" });
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(dialog).toHaveTextContent("CLI");
		expect(fetchMock).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog", { name: "Revoke this API token?" })).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps the revoke dialog open with an inline error when the API revoke fails", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			json: async () => ({ error: "Database temporarily unavailable" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke CLI" }));
		const dialog = await screen.findByRole("dialog", { name: "Revoke this API token?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

		// In the dialog itself: on the page behind it the reason was covered.
		expect(await within(dialog).findByText("Database temporarily unavailable")).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "Revoke this API token?" })).toBeInTheDocument();
		expect(within(dialog).queryByText("Revoked")).not.toBeInTheDocument();
	});

	it("revokes an API token after in-app confirmation and updates the list", async () => {
		const revoked = { ...token, revokedAt: "2026-01-02T00:00:00Z" };
		const fetchMock = vi.fn().mockResolvedValueOnce(json({ token: revoked }))
			.mockResolvedValueOnce(json(page([revoked])));
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialPage={page([token])} pageSize={25} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke CLI" }));
		const dialog = await screen.findByRole("dialog", { name: "Revoke this API token?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/api-tokens?id=tok_1", expect.objectContaining({
			method: "DELETE",
		})));
		expect(await screen.findByText("Revoked", { selector: "span" })).toBeInTheDocument();
	});
});
