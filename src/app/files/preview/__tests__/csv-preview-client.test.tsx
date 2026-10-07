import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CsvPreviewClient } from "../csv-preview-client";

describe("table preview", () => {
  it("renders TSV correctly and does not discard extra data columns", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("name\tvalue\na,b\t1\textra")));
    render(<CsvPreviewClient href="/api/files/test" name="data.tsv" />);
    expect(await screen.findByText("a,b")).toBeInTheDocument();
    expect(screen.getByText("extra")).toBeInTheDocument();
  });
  it("does not render a rejected response as file content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private data", { status: 403 })));
    render(<CsvPreviewClient href="/api/files/test" />);
    expect(await screen.findByText("csvPreview.loadFailedWithStatus")).toBeInTheDocument();
    expect(screen.queryByText("private data")).not.toBeInTheDocument();
  });
  it("cancels obsolete streams when changing files", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
      .mockResolvedValueOnce(new Response("header\nnew row"));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<CsvPreviewClient href="/api/files/old" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    view.rerender(<CsvPreviewClient href="/api/files/new" />);
    expect(await screen.findByText("new row")).toBeInTheDocument();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
