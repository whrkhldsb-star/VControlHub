import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "../settings-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { csrfFetch } from "@/lib/auth/csrf-client";

/** What the page renders for a stored SMTP password: the "***" sentinel. */
const SMTP = {
  "smtp.enabled": "true",
  "smtp.host": "smtp.example.com",
  "smtp.port": "587",
  "smtp.user": "mailer",
  "smtp.pass": "***",
  "smtp.from": "ops@example.com",
  "smtp.alertRecipients": "",
};

function renderSmtp(pass = "***") {
  renderWithI18n(<SettingsClient settings={{ ...SMTP, "smtp.pass": pass }} canManage />, { locale: "zh" });
  const password = screen.getByLabelText("密码");
  const section = password.closest("section")!;
  return { password, save: within(section).getByRole("button", { name: "保存" }) };
}

async function savedBody() {
  await waitFor(() => expect(csrfFetch).toHaveBeenCalled());
  return JSON.parse(String(vi.mocked(csrfFetch).mock.calls[0]![1]!.body)) as Record<string, string>;
}

describe("masked secrets on the settings page", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
  });

  it("sends the sentinel back unchanged so the stored password is kept", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.clear(screen.getByLabelText("SMTP 服务器"));
    await user.type(screen.getByLabelText("SMTP 服务器"), "mail.example.com");
    await user.click(save);

    const body = await savedBody();
    expect(body["smtp.host"]).toBe("mail.example.com");
    expect(body["smtp.pass"]).toBe("***");
    expect(password).toHaveValue("");
  });

  it("shows a stored secret as an empty field with a replace hint", () => {
    const { password } = renderSmtp();
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("placeholder", "已保存，输入新值即替换");
  });

  async function confirmAndRead(save: HTMLElement) {
    const user = userEvent.setup();
    await user.click(save);
    await screen.findByTestId("high-risk-confirm-modal");
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    return savedBody();
  }

  it.each(["n3w-pass", "***abc", "abc***", "***", "*"])("saves a typed new password verbatim: %s", async (secret) => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.click(password);
    await user.keyboard(secret.replace(/[{[]/g, "$&$&"));
    expect(password).toHaveValue(secret);
    const body = await (secret === "***" ? (async () => { await user.click(save); return savedBody(); })() : confirmAndRead(save));
    // "***" is the keep-sentinel itself; the API cannot tell it from "unchanged".
    expect(body["smtp.pass"]).toBe(secret);
  });

  it("saves a pasted new password verbatim", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.click(password);
    await user.paste("p*ss***");
    expect(password).toHaveValue("p*ss***");
    expect((await confirmAndRead(save))["smtp.pass"]).toBe("p*ss***");
  });

  it("keeps the stored password when a typed replacement is deleted again", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.type(password, "ab");
    await user.clear(password);
    expect(password).toHaveValue("");
    await user.click(save);

    expect((await savedBody())["smtp.pass"]).toBe("***");
  });

  it("clears the stored password only through the explicit clear button", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.click(screen.getByRole("button", { name: "清除已保存的密码" }));
    expect(screen.queryByRole("button", { name: "清除已保存的密码" })).not.toBeInTheDocument();
    expect(password).toHaveValue("");

    expect((await confirmAndRead(save))["smtp.pass"]).toBe("");
  });
});

describe("masked secrets across consecutive saves (no reload)", () => {
  const CLEAR = "清除已保存的密码";
  const STORED_HINT = "已保存，输入新值即替换";

  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
    vi.mocked(csrfFetch).mockResolvedValue({ success: true });
  });

  /** Save a high-risk change and return the PATCH body of that save. */
  async function saveChange(user: ReturnType<typeof userEvent.setup>, save: HTMLElement) {
    const before = vi.mocked(csrfFetch).mock.calls.length;
    await user.click(save);
    await screen.findByTestId("high-risk-confirm-modal");
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(vi.mocked(csrfFetch).mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(screen.queryByTestId("high-risk-confirm-modal")).not.toBeInTheDocument());
    return JSON.parse(String(vi.mocked(csrfFetch).mock.calls[before]![1]!.body)) as Record<string, string>;
  }

  function expectStored(password: HTMLElement) {
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("placeholder", STORED_HINT);
    expect(screen.getByRole("button", { name: CLEAR })).toBeInTheDocument();
  }

  function expectNothingStored(password: HTMLElement) {
    expect(password).toHaveValue("");
    expect(password).not.toHaveAttribute("placeholder", STORED_HINT);
    expect(screen.queryByRole("button", { name: CLEAR })).not.toBeInTheDocument();
  }

  it("none → type → save → explicit clear → save", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp("");
    expectNothingStored(password);
    await user.type(password, "first*");
    expect((await saveChange(user, save))["smtp.pass"]).toBe("first*");
    expectStored(password);

    await user.click(screen.getByRole("button", { name: CLEAR }));
    expect((await saveChange(user, save))["smtp.pass"]).toBe("");
    expectNothingStored(password);
  });

  it("stored → replace → save → explicit clear → save", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    expectStored(password);
    await user.type(password, "***second");
    expect((await saveChange(user, save))["smtp.pass"]).toBe("***second");
    expectStored(password);

    // Typing and deleting after the save still keeps the newly stored secret.
    await user.type(password, "x");
    await user.clear(password);
    expectStored(password);

    await user.click(screen.getByRole("button", { name: CLEAR }));
    expect((await saveChange(user, save))["smtp.pass"]).toBe("");
    expectNothingStored(password);
  });

  it("stored → clear → save → type new → save → explicit clear → save", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.click(screen.getByRole("button", { name: CLEAR }));
    expect((await saveChange(user, save))["smtp.pass"]).toBe("");
    expectNothingStored(password);

    await user.type(password, "third");
    expect((await saveChange(user, save))["smtp.pass"]).toBe("third");
    expectStored(password);

    await user.click(screen.getByRole("button", { name: CLEAR }));
    expect((await saveChange(user, save))["smtp.pass"]).toBe("");
    expectNothingStored(password);
  });

  it("a cleared field stays cleared when text is typed and deleted before saving", async () => {
    const user = userEvent.setup();
    const { password, save } = renderSmtp();
    await user.click(screen.getByRole("button", { name: CLEAR }));
    await user.type(password, "oops");
    await user.clear(password);
    expect((await saveChange(user, save))["smtp.pass"]).toBe("");
  });
});
