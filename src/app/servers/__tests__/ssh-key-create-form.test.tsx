import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ createSshKeyAction: vi.fn() }));
vi.mock("../actions", () => actions);
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
  it("keeps what was typed when the key is refused", async () => {
    // React clears the fields of a form whose action has answered, a refusal included: a name that was taken
    // cost the pasted private key and its passphrase.
    actions.createSshKeyAction.mockImplementation(async () => ({ error: "SSH 密钥名称已存在" }));
    render(<SshKeyCreateForm />);
    const name = screen.getByLabelText("common.name");
    const privateKey = screen.getByLabelText("serversPage.sshKeyCreate.privateKeyLabel");
    const passphrase = document.querySelector('[name="passphrase"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: "prod" } });
    fireEvent.change(privateKey, { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----" } });
    fireEvent.change(passphrase, { target: { value: "s3cret" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "serversPage.sshKeyCreate.title" }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(await screen.findByText("SSH 密钥名称已存在")).toBeInTheDocument();
    expect(name).toHaveValue("prod");
    expect(privateKey).toHaveValue("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----");
    expect(passphrase).toHaveValue("s3cret");
  });

  it("starts empty again once the key is saved", async () => {
    actions.createSshKeyAction.mockImplementation(async () => ({ success: "SSH 密钥已保存" }));
    render(<SshKeyCreateForm />);
    const name = screen.getByLabelText("common.name");
    fireEvent.change(name, { target: { value: "prod" } });
    fireEvent.change(screen.getByLabelText("serversPage.sshKeyCreate.privateKeyLabel"), { target: { value: "key" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "serversPage.sshKeyCreate.title" }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(await screen.findByText("SSH 密钥已保存")).toBeInTheDocument();
    expect(name).toHaveValue("");
  });
});
