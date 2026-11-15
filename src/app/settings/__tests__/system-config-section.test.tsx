import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { SystemConfigSection } from "../system-config-section";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
const readers: ControlledReader[] = [];
class ControlledReader {
  result = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  abort = vi.fn();
  readAsText() { readers.push(this); }
  complete(marker: string) { this.result = JSON.stringify({ schemaVersion: 1, marker }); this.onload?.(); }
}
const preview = { totalRecords: 1, summary: {}, warnings: [] };
function upload(name: string) {
  fireEvent.change(screen.getByLabelText("Select .vch.json file"), { target: { files: [new File(["{}"], name)] } });
}

describe("config import preview identity", () => {
  beforeEach(() => {
    readers.length = 0;
    vi.mocked(csrfFetch).mockReset();
    vi.stubGlobal("FileReader", ControlledReader);
  });

  it("discards old reads and clears the previous file while the new file is loading", async () => {
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    upload("old.json");
    upload("new.json");
    expect(readers[0]!.abort).toHaveBeenCalled();
    act(() => readers[0]!.complete("old"));
    expect(screen.queryByRole("button", { name: "Preview import" })).not.toBeInTheDocument();
    act(() => readers[1]!.complete("new"));
    vi.mocked(csrfFetch).mockResolvedValue({ preview });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview import" })); });
    expect(JSON.parse(String(vi.mocked(csrfFetch).mock.calls[0]![1]?.body)).file.marker).toBe("new");
    upload("third.json");
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview import" })).not.toBeInTheDocument();
  });

  it("rejects preview responses from old import options", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(csrfFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    upload("config.json");
    act(() => readers[0]!.complete("current"));
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    const signal = vi.mocked(csrfFetch).mock.calls[0]![1]?.signal;
    fireEvent.click(screen.getByRole("checkbox", { name: /Overwrite existing/ }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ preview }); });
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeEnabled();
  });

  it("locks file and option changes during execution and consumes the preview", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(csrfFetch).mockResolvedValueOnce({ preview }).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    upload("config.json");
    act(() => readers[0]!.complete("current"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview import" })); });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByLabelText("Select .vch.json file")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Overwrite existing/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
    await act(async () => { resolve({ result: { created: 1, updated: 0, skipped: 0 } }); });
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import complete");
    expect(csrfFetch).toHaveBeenCalledTimes(2);
  });
});

describe("config export", () => {
  beforeEach(() => vi.mocked(csrfFetch).mockReset());

  it("says why the export was refused", async () => {
    // The file is asked for as it comes, so a refusal is not thrown: its sentence was dropped for "Export failed".
    vi.mocked(csrfFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "FORBIDDEN", error: "Forbidden", message: "Missing permission: system:export" }), { status: 403 }) as never,
    );
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download config snapshot" }));
    });
    expect(await screen.findByText("Missing permission: system:export")).toBeInTheDocument();
  });

  it("names what failed when the answer is not the application's", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }) as never);
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download config snapshot" }));
    });
    expect(await screen.findByText("Export failed")).toBeInTheDocument();
  });
});
