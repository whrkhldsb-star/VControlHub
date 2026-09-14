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
    expect(screen.queryByRole("button", { name: "Preview Import" })).not.toBeInTheDocument();
    act(() => readers[1]!.complete("new"));
    vi.mocked(csrfFetch).mockResolvedValue({ preview });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview Import" })); });
    expect(JSON.parse(String(vi.mocked(csrfFetch).mock.calls[0]![1]?.body)).file.marker).toBe("new");
    upload("third.json");
    expect(screen.queryByRole("button", { name: "Confirm Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview Import" })).not.toBeInTheDocument();
  });

  it("rejects preview responses from old import options", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(csrfFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    upload("config.json");
    act(() => readers[0]!.complete("current"));
    fireEvent.click(screen.getByRole("button", { name: "Preview Import" }));
    const signal = vi.mocked(csrfFetch).mock.calls[0]![1]?.signal;
    fireEvent.click(screen.getByRole("checkbox", { name: /Overwrite existing/ }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ preview }); });
    expect(screen.queryByRole("button", { name: "Confirm Import" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Import" })).toBeEnabled();
  });

  it("locks file and option changes during execution and consumes the preview", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(csrfFetch).mockResolvedValueOnce({ preview }).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderWithI18n(<SystemConfigSection isPlatformAdmin />, { locale: "en" });
    upload("config.json");
    act(() => readers[0]!.complete("current"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview Import" })); });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));
    expect(screen.getByLabelText("Select .vch.json file")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Overwrite existing/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview Import" })).toBeDisabled();
    await act(async () => { resolve({ result: { created: 1, updated: 0, skipped: 0 } }); });
    expect(screen.queryByRole("button", { name: "Confirm Import" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import complete");
    expect(csrfFetch).toHaveBeenCalledTimes(2);
  });
});
