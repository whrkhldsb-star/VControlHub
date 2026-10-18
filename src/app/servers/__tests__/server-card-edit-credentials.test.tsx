import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { ServerCardEditForm } from "../server-card-edit-form";
import { SshKeyOptionsProvider } from "../ssh-key-options";

vi.mock("@/components/submit-button", () => ({
  SubmitButton: ({ children }: { children: React.ReactNode }) => <button type="submit">{children}</button>,
}));

const keys = [
  { id: "key-1", name: "deploy", fingerprint: "SHA256:one", description: null },
  { id: "key-2", name: "ops", fingerprint: "SHA256:two", description: null },
];

function renderForm(props: Partial<React.ComponentProps<typeof ServerCardEditForm>> = {}) {
  return render(
    <SshKeyOptionsProvider sshKeys={keys}>
      <ServerCardEditForm
        serverId="srv_1"
        serverName="hk-node-01"
        host="203.0.113.10"
        port={22}
        username="root"
        connectionType="SSH_KEY"
        sshKeyId="key-2"
        description={null}
        tags={[]}
        costAutoSync={false}
        costMonthlyAmount={null}
        costCurrency="CNY"
        costProvider={null}
        costLastSyncedAt={null}
        editAction={vi.fn()}
        editState={{}}
        {...props}
      />
    </SshKeyOptionsProvider>,
  );
}

const connectionType = (container: HTMLElement) =>
  (container.querySelector('input[type="hidden"][name="connectionType"]') as HTMLInputElement).value;

describe("server edit form credentials", () => {
  it("shows a key node's current key from the library and lets it be replaced", async () => {
    const { container } = renderForm();
    const select = screen.getByLabelText("SSH 密钥") as HTMLSelectElement;
    expect(select.value).toBe("key-2");
    expect(select).toBeRequired();
    expect([...select.options].map((option) => option.textContent)).toEqual(["请选择已有密钥", "deploy", "ops"]);
    await userEvent.selectOptions(select, "key-1");
    expect(select.value).toBe("key-1");
    expect(connectionType(container)).toBe("SSH_KEY");
    expect(container.querySelector('input[name="password"]')).toBeNull();
  });

  it("switches a key node to a password, which is then required", async () => {
    const { container } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "密码" }));
    expect(connectionType(container)).toBe("PASSWORD");
    expect(container.querySelector('select[name="sshKeyId"]')).toBeNull();
    expect(container.querySelector('input[name="password"]')).toBeRequired();
  });

  it("keeps a password node's password unless a new one is typed, and requires a key when switching to one", async () => {
    const { container } = renderForm({ connectionType: "PASSWORD", sshKeyId: null });
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(password).not.toBeRequired();
    expect(screen.getByLabelText("新密码（留空保持不变）")).toBe(password);

    await userEvent.click(screen.getByRole("button", { name: "SSH 密钥" }));
    const select = container.querySelector('select[name="sshKeyId"]') as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select).toBeRequired();
    expect(connectionType(container)).toBe("SSH_KEY");
  });

  it("keeps a key that is outside the editor's library selectable", () => {
    renderForm({ sshKeyId: "key-of-another-customer" });
    const select = screen.getByLabelText("SSH 密钥") as HTMLSelectElement;
    expect(select.value).toBe("key-of-another-customer");
    expect(select.selectedOptions[0]?.textContent).toBe("当前密钥（不在你的密钥库中）");
  });
});
