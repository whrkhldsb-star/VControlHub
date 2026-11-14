import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VpsBackupSection } from "../vps-backup-section";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function mockInitialLoad(fetchMock: ReturnType<typeof vi.fn>, schedules: unknown[] = [], records: unknown[] = []) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ schedules }))
    .mockResolvedValueOnce(jsonResponse({ records }));
}

describe("VpsBackupSection", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the server error instead of hiding a failed load behind empty lists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "Backup permission denied" }), { status: 403 })));
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });
    expect(await screen.findByText("Backup permission denied")).toBeInTheDocument();
  });

  it("renders schedule guidance and opens a labelled quick-create form", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    expect(await screen.findByText("No backup schedules")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quick: Nginx daily 03:00" }));

    expect(screen.getByLabelText("Schedule name")).toHaveValue("Daily Nginx config backup");
    expect(screen.getByLabelText("Backup type")).toHaveValue("nginx-config");
    expect(screen.getByLabelText("Cron expression")).toHaveValue("0 3 * * *");
  });

  it("deletes schedules only after an in-app confirmation", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [{ id: "sch-1", name: "Nightly", cronExpression: "0 3 * * *", backupType: "nginx-config", status: "ACTIVE", retentionDays: 7, lastRunAt: null, nextRunAt: null }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    await screen.findByText("Nightly");
    fireEvent.click(screen.getByRole("button", { name: "Delete Nightly" }));
    expect(screen.getByRole("dialog", { name: "Delete backup schedule" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(undefined))
      .mockResolvedValueOnce(jsonResponse({ schedules: [] }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/servers/srv-1/vps-backup/schedules/sch-1", expect.objectContaining({ method: "DELETE" })));
  });

  it("offers edit and pause actions, then patches the selected schedule", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [{ id: "sch-1", name: "Nightly", cronExpression: "0 3 * * *", backupType: "nginx-config", status: "ACTIVE", paths: [], retentionDays: 7, lastRunAt: null, nextRunAt: "2026-01-02T03:00:00Z" }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    await screen.findByText("Nightly");
    expect(screen.getByRole("button", { name: "Edit backup schedule Nightly" })).toBeInTheDocument();

    fetchMock
      .mockResolvedValueOnce(jsonResponse(undefined))
      .mockResolvedValueOnce(jsonResponse({ schedules: [] }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/servers/srv-1/vps-backup/schedules/sch-1",
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("opens an inline editor with the selected schedule values", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [{ id: "sch-1", name: "Nightly", cronExpression: "0 3 * * *", backupType: "custom", status: "PAUSED", paths: ["/srv/app"], retentionDays: 7, lastRunAt: null, nextRunAt: null }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    await screen.findByText("Nightly");
    fireEvent.click(screen.getByRole("button", { name: "Edit backup schedule Nightly" }));

    expect(screen.getByRole("button", { name: "Save schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cron expression")).toHaveValue("0 3 * * *");
    expect(screen.getAllByLabelText("Custom paths (one per line, only for custom type)")[1]).toHaveValue("/srv/app");
  });

  it("shows a refused deletion in the dialog that asked for it", async () => {
    // The dialog stays open over the section, and the reason was written to the section's notice behind it.
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [{ id: "sch-1", name: "Nightly", cronExpression: "0 3 * * *", backupType: "nginx-config", status: "ACTIVE", retentionDays: 7, lastRunAt: null, nextRunAt: null }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });
    await screen.findByText("Nightly");
    fireEvent.click(screen.getByRole("button", { name: "Delete Nightly" }));
    const dialog = screen.getByRole("dialog", { name: "Delete backup schedule" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "A backup of this schedule is still running" }, false));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A backup of this schedule is still running");
    expect(screen.getAllByText("A backup of this schedule is still running")).toHaveLength(1);

    // Opened again, the dialog does not carry the last refusal.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Nightly" }));
    expect(within(screen.getByRole("dialog", { name: "Delete backup schedule" })).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("quotes the sentence of a refused backup, not the name of its error", async () => {
    // Read by hand, a refusal showed its `error` field: "Forbidden" for a missing permission.
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });
    await screen.findByText("No backup schedules");

    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "FORBIDDEN", error: "Forbidden", message: "Missing permission: server:backup" }, false));
    fireEvent.click(screen.getByRole("button", { name: /Nginx config/ }));
    expect(await screen.findByText("Missing permission: server:backup")).toBeInTheDocument();
    expect(screen.queryByText("Forbidden")).not.toBeInTheDocument();
  });

  it("lets the whole reason of a failed backup be read", async () => {
    const reason = "tar: /var/lib/docker/volumes/app_data/_data: Cannot open: Permission denied\ntar: Exiting with failure status due to previous errors";
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [], [{ id: "rec-1", backupType: "docker-volumes", status: "FAILED", fileSize: null, localPath: null, offsiteKey: null, errorMessage: reason, createdAt: "2026-01-01T00:00:00Z", durationMs: 1200 }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });
    const line = await screen.findByText(/Cannot open: Permission denied/);
    // One cut line with no way to the rest; now it wraps, and scrolls when it is long.
    expect(line).not.toHaveClass("truncate");
    expect(line).toHaveClass("whitespace-pre-wrap", "break-words", "overflow-y-auto");
  });

  it("uses accessible icon actions for completed records", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [], [{ id: "rec-1", backupType: "nginx-config", status: "COMPLETED", fileSize: "1024", localPath: "/tmp/a.tar", offsiteKey: null, errorMessage: null, createdAt: "2026-01-01T00:00:00Z", durationMs: "1000" }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    await screen.findByText("Completed");
    expect(screen.getByRole("link", { name: "Download backup record" })).toHaveAttribute("href", "/api/servers/srv-1/vps-backup/records/rec-1/download");
    expect(screen.getByRole("button", { name: "Delete backup record" })).toBeInTheDocument();
  });

  it("keeps manual backup triggers out of the read-only view", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage={false} />, { locale: "en" });

    await screen.findByText("No backup schedules");
    expect(screen.queryByText("Manual backup trigger")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nginx configuration/ })).not.toBeInTheDocument();
  });
});
