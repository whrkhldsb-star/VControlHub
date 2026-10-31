import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { CustomersClient, type Customer } from "../customers-client";

const addToastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/customers" }));
vi.mock("@/components/toast-provider", () => ({
  useToast: () => ({ addToast: addToastMock }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../identity-templates-section", () => ({ IdentityTemplatesSection: () => null }));
vi.mock("../customer-members-dialog", () => ({ CustomerMembersDialog: () => null }));

const acme: Customer = {
  id: "team_a", slug: "acme", name: "Acme", description: null, createdAt: "2026-10-01T00:00:00.000Z", deletedAt: null,
  _count: { members: 2, servers: 3, storageNodes: 1 },
};


it("locks draft fields and cancel while the create request is pending", async () => {
 let resolve!: (v: unknown) => void;
 vi.mocked(csrfFetch).mockImplementation(async (_url, options) => options?.method === "POST" ? new Promise(done => { resolve = done; }) : { teams: [acme], deletedTeams: [] });
 render(<CustomersClient />);
 await screen.findByText("Acme");
 fireEvent.click(screen.getByRole("button", { name: "新建客户" }));
 fireEvent.change(document.querySelector("#customer-name")!, { target: { value: "First customer" } });
 const buttons = screen.getAllByRole("button", { name: "新建客户" });
 fireEvent.click(buttons[buttons.length - 1]!);
 expect(document.querySelector("#customer-name")).toBeDisabled();
 expect(document.querySelector("#customer-slug")).toBeDisabled();
 expect(document.querySelector("#customer-description")).toBeDisabled();
 expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
 await act(async () => { resolve({ success: true }); });
 fireEvent.click(screen.getByRole("button", { name: "新建客户" }));
 expect(document.querySelector("#customer-name")).toHaveValue("");
 const sent = vi.mocked(csrfFetch).mock.calls.find(([,o]) => o?.method === "POST");
 expect(JSON.parse(String(sent?.[1]?.body)).name).toBe("First customer");
});
