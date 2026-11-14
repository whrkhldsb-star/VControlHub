import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiTokenManagerClient } from "../api-token-manager-client";

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

describe("ApiTokenManagerClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("creates an API token through JSON and shows the plaintext only in the one-time result panel", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				token: "whr_plain_once",
				apiToken: { ...token, id: "tok_2", name: "mobile", scopes: ["read", "status:read"], tokenSuffix: "n_once" },
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialTokens={[token]} allowedScopes={["read", "health:read", "status:read"]} currentCustomerName="Ops" />, { locale: "en" });

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
		expect(screen.getByText("mobile")).toBeInTheDocument();
		// Created: the form closed under the plaintext, and the next token starts from the header again.
		expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create API token" })).toBeInTheDocument();
	});

	it("closes the form on Cancel and says a refusal inside it", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "A token with this name exists" }) }));
		render(<ApiTokenManagerClient header={header} initialTokens={[]} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
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
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
				ok: true,
				status: 201,
				json: async () => ({ token: "whr_plain_once", apiToken: { ...token, id: "tok_2", name: "mobile" } }),
			}));
			render(<ApiTokenManagerClient header={header} initialTokens={[token]} allowedScopes={["read"]} currentCustomerName="Ops" />, { locale: "en" });
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

		render(<ApiTokenManagerClient header={header} initialTokens={[token]} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
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

		render(<ApiTokenManagerClient header={header} initialTokens={[token]} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke CLI" }));
		const dialog = await screen.findByRole("dialog", { name: "Revoke this API token?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

		// In the dialog itself: on the page behind it the reason was covered.
		expect(await within(dialog).findByText("Database temporarily unavailable")).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "Revoke this API token?" })).toBeInTheDocument();
		expect(within(dialog).queryByText("Revoked")).not.toBeInTheDocument();
	});

	it("revokes an API token after in-app confirmation and updates the list", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ token: { ...token, revokedAt: "2026-01-02T00:00:00Z" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient header={header} initialTokens={[token]} allowedScopes={["read", "health:read"]} currentCustomerName="Ops" />, { locale: "en" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke CLI" }));
		const dialog = await screen.findByRole("dialog", { name: "Revoke this API token?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/api-tokens?id=tok_1", expect.objectContaining({
			method: "DELETE",
		})));
		expect(await screen.findByText("Revoked")).toBeInTheDocument();
	});
});
