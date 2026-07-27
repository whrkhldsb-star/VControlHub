import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { StorageNodeFields } from "../storage-node-fields";

const servers = [{ id: "s1", name: "Tokyo", host: "10.0.0.1" }];

function renderFields(driver: "LOCAL" | "SFTP", values = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <StorageNodeFields driver={driver} onDriverChange={() => undefined} servers={servers} values={values} />
    </I18nProvider>,
  );
}

describe("StorageNodeFields", () => {
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
});
