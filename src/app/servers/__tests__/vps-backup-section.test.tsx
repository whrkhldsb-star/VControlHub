import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

  it("renders schedule guidance and opens a labelled quick-create form", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    expect(await screen.findByText("No backup schedules")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quick: Nginx daily 03:00" }));

    expect(screen.getByLabelText("Schedule Name")).toHaveValue("Daily Nginx config backup");
    expect(screen.getByLabelText("Backup Type")).toHaveValue("nginx-config");
    expect(screen.getByLabelText("Cron Expression")).toHaveValue("0 3 * * *");
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

  it("uses accessible icon actions for completed records", async () => {
    const fetchMock = vi.fn();
    mockInitialLoad(fetchMock, [], [{ id: "rec-1", backupType: "nginx-config", status: "COMPLETED", fileSize: "1024", localPath: "/tmp/a.tar", offsiteKey: null, errorMessage: null, createdAt: "2026-01-01T00:00:00Z", durationMs: "1000" }]);
    vi.stubGlobal("fetch", fetchMock);
    render(<VpsBackupSection serverId="srv-1" canManage />, { locale: "en" });

    await screen.findByText("COMPLETED");
    expect(screen.getByRole("link", { name: "Download backup record" })).toHaveAttribute("href", "/api/servers/srv-1/vps-backup/records/rec-1/download");
    expect(screen.getByRole("button", { name: "Delete backup record" })).toBeInTheDocument();
  });
});
