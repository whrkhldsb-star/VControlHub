import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({ createSshKeyAction: vi.fn() }));
import { SshKeyCreateForm } from "../ssh-key-create-form";

describe("SshKeyCreateForm", () => {
  it.each(["id_ed25519", "legacy.key", "key.der", "key.ppk"])("accepts %s and requires private text only without a file", async name => {
    render(<SshKeyCreateForm />);
    const input = screen.getByLabelText("serversPage.sshKeyCreate.fileUploadLabel") as HTMLInputElement;
    const privateKey = screen.getByLabelText("serversPage.sshKeyCreate.privateKeyLabel");
    expect(privateKey).toBeRequired();
    expect(input).not.toHaveAttribute("accept");
    await userEvent.upload(input, new File(["key"], name));
    expect(input.files?.[0]?.name).toBe(name);
    expect(privateKey).not.toBeRequired();
    fireEvent.change(input, { target: { files: [] } });
    expect(privateKey).toBeRequired();
  });
  it("keeps only the basic fields visible and one generic password collapsed", () => {
    render(<SshKeyCreateForm />);
    expect(document.querySelector("details")).not.toHaveAttribute("open");
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(document.querySelector('[name="description"]')).toBeNull();
    expect(document.querySelector('[name="ppkPassphrase"]')).toBeNull();
  });
});
