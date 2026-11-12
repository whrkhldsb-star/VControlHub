import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { StorageNodeFields } from "../storage-node-fields";

const servers = [{ id: "s1", name: "Tokyo", host: "10.0.0.1" }];

function renderFields(driver: "LOCAL" | "SFTP" | "WEBDAV", values = {}, lockDefault = false) {
  return render(
    <I18nProvider initialLocale="en">
      <StorageNodeFields driver={driver} onDriverChange={() => undefined} servers={servers} values={values} lockDefault={lockDefault} />
    </I18nProvider>,
  );
}

describe("StorageNodeFields", () => {
  it("renders WebDAV configuration without VPS binding or a public URL, never prefills secrets", () => {
    renderFields("WEBDAV", { webdavConfig: { url: "https://dav.example.com/", authType: "basic", username: "alice", hasPassword: true } });
    expect(screen.getByLabelText("WebDAV endpoint (HTTPS)")).toHaveValue("https://dav.example.com/");
    expect(screen.getByLabelText("WebDAV password")).toHaveValue("");
    expect(screen.getByLabelText("WebDAV password")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("WebDAV endpoint (HTTPS)"), { target: { value: "https://other.example.com/" } });
    expect(screen.getByLabelText("WebDAV password")).toBeRequired();
    expect(screen.queryByLabelText(/Bind VPS/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Public base URL/)).not.toBeInTheDocument();
  });
  it("renders common fields without remote-only fields for local storage", () => {
    renderFields("LOCAL");
    expect(screen.getByLabelText("Node name")).toBeVisible();
    expect(screen.getByLabelText("Driver")).toBeVisible();
    expect(screen.getByLabelText("Base path")).toBeVisible();
    expect(screen.queryByLabelText(/Remote host/)).not.toBeInTheDocument();
  });

  it("renders the shared SFTP fields with edit defaults", () => {
    renderFields("SFTP", { serverId: "s1", host: "sftp.example.com", port: 2200, username: "deploy", directAccessMode: "DIRECT", publicBaseUrl: "https://files.example.com", directAccessExpiresSeconds: 600, isDefault: true });
    expect(screen.getByLabelText(/Remote host/)).toHaveValue("sftp.example.com");
    expect(screen.getByLabelText("Port")).toHaveValue(2200);
    expect(screen.getByLabelText("Username")).toHaveValue("deploy");
    expect(screen.getByLabelText("Set as default storage node")).toBeChecked();
  });

  it("allows either a bound VPS or an explicit remote host", () => {
    renderFields("SFTP");

    expect(screen.getByLabelText(/Bind VPS/)).not.toBeRequired();
    expect(screen.getByLabelText(/Remote host/)).not.toBeRequired();
    expect(screen.getByTestId("sftp-endpoint-hint")).toHaveTextContent(/at least one/i);
    expect(screen.getByLabelText(/Bind VPS/)).toHaveProperty(
      "validationMessage",
      expect.stringMatching(/at least one/i),
    );
  });

  it("does not draw an untouched field as if it were wrong", () => {
    // "Bind VPS" and "Remote host" carried the danger border at all times.
    renderFields("SFTP");
    expect(screen.getByLabelText(/Bind VPS/).className).not.toMatch(/danger/);
    expect(screen.getByLabelText(/Remote host/).className).not.toMatch(/danger/);
  });

  it("locks the driver and default checkbox for the active default node", () => {
    renderFields("LOCAL", { isDefault: true }, true);

    expect(screen.getByLabelText("Driver")).toBeDisabled();
    expect(screen.getByLabelText("Set as default storage node")).toBeDisabled();
    expect(screen.getByText(/Set another node as default/)).toBeVisible();
  });

  it("gives each form its own fields: a label opens the field of its own form", () => {
    // The create form and every open edit form are on one page and shared fixed ids, so a label pointed at
    // the first field with that id, which is in another form.
    const { container } = render(
      <I18nProvider initialLocale="en">
        <form data-testid="edit"><StorageNodeFields driver="SFTP" onDriverChange={() => undefined} servers={servers} values={{ name: "old" }} /></form>
        <form data-testid="create"><StorageNodeFields driver="SFTP" onDriverChange={() => undefined} servers={servers} /></form>
      </I18nProvider>,
    );
    const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of ["Node name", "Base path", "Port", "Username"]) {
      const [inEdit, inCreate] = screen.getAllByLabelText(label);
      expect(screen.getByTestId("edit")).toContainElement(inEdit!);
      expect(screen.getByTestId("create")).toContainElement(inCreate!);
    }
  });
});
