import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the knowledge-base client.
 *
 * The properties worth pinning:
 *
 * 1. **Deleting the selected base re-points the selection.** `loadBases` checks
 *    whether the current `selectedId` still exists and falls back to the first
 *    remaining base. Without that, the page would keep requesting a base that is
 *    gone and sit on a permanent error.
 *
 * 2. **Destructive actions are staged behind ConfirmDialog**, and every id is
 *    passed through `encodeURIComponent` — these ids reach the API as query
 *    parameters (`?documentId=…`), so raw interpolation would let an id
 *    containing `&` graft on another parameter.
 *
 * 3. **`canManage` gates the writes in the handler, not only in the markup.** A
 *    read-only viewer must not be able to reach a delete even programmatically.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn(), addToast: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
vi.mock("@/components/toast-provider", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
// Interpolate the vars: several aria-labels are only distinguishable by them
// (`deleteBaseAria` includes the base name), and dropping them makes every row's
// label identical.
const i18n = {
  t: (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
  locale: "zh" as const,
  setLocale: () => {},
};
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => i18n }));

import { KnowledgeClient } from "../knowledge-client";

const bases = [
  { id: "kb_1", name: "runbooks", description: null, documentCount: 2, chunkCount: 10, updatedAt: "2026-08-31T00:00:00.000Z" },
  { id: "kb_2", name: "policies", description: null, documentCount: 1, chunkCount: 4, updatedAt: "2026-08-31T00:00:00.000Z" },
];
const documents = [
  { id: "doc_1", title: "restart nginx", sourceType: "TEXT", status: "READY", chunkCount: 3, updatedAt: "2026-08-31T00:00:00.000Z" },
];

function seed(overrides: { bases?: unknown[]; documents?: unknown[] } = {}) {
  mocks.csrfFetch.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.startsWith("/api/knowledge/")) {
      return { knowledgeBase: { documents: overrides.documents ?? documents } };
    }
    return { knowledgeBases: overrides.bases ?? bases };
  });
}

function renderClient(canManage = true) {
  return render(<KnowledgeClient canManage={canManage} />);
}

describe("KnowledgeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrfFetch.mockReset();
    seed();
  });

  it("loads the base list and selects the first one on mount", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge");
    await waitFor(() =>
      expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge/kb_1"),
    );
  });

  it("percent-encodes the base id in the detail request", async () => {
    // The id lands in a path segment; an unencoded one could escape it.
    seed({
      bases: [{ id: "kb/1 odd", name: "odd", description: null, documentCount: 0, chunkCount: 0, updatedAt: "2026-08-31T00:00:00.000Z" }],
    });
    renderClient();
    await waitFor(() =>
      expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge/kb%2F1%20odd"),
    );
  });

  it("surfaces a load failure instead of rendering an empty page", async () => {
    mocks.csrfFetch.mockRejectedValue(new Error("database unavailable"));
    renderClient();
    await waitFor(() => expect(screen.getByText(/database unavailable/)).toBeInTheDocument());
  });

  describe("destructive actions", () => {
    it("stages a base deletion rather than deleting on the first click", async () => {
      renderClient();
      await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
      mocks.csrfFetch.mockClear();
      fireEvent.click(screen.getByLabelText("knowledgePage.deleteBaseAria:runbooks"));
      expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
    });

    it("re-points the selection when the deleted base was the selected one", async () => {
      // Otherwise the page keeps requesting a base that no longer exists.
      renderClient();
      await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText("knowledgePage.deleteBaseAria:runbooks"));
      // After the delete the list only has kb_2 left.
      mocks.csrfFetch.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes("?id=")) return {};
        if (u.startsWith("/api/knowledge/")) return { knowledgeBase: { documents: [] } };
        return { knowledgeBases: [bases[1]] };
      });
      fireEvent.click(await screen.findByRole("button", { name: /confirmDelete|common\.confirmDelete/ }));
      await waitFor(() =>
        expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge?id=kb_1", { method: "DELETE" }),
      );
      await waitFor(() =>
        expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge/kb_2"),
      );
    });
  });

  it("shows a failed deletion in the confirmation dialog, where the person is looking", async () => {
    // The reason was written into a notice at the foot of the page, behind the dialog, which stayed open as if
    // nothing had happened.
    renderClient();
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    mocks.csrfFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") throw new Error("知识库正在被 AI 会话使用");
      if (String(url).startsWith("/api/knowledge/")) return { knowledgeBase: { documents } };
      return { knowledgeBases: bases };
    });
    fireEvent.click(screen.getByLabelText("knowledgePage.deleteBaseAria:runbooks"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "common.confirmDelete" }));
    expect(await within(dialog).findByText("知识库正在被 AI 会话使用")).toBeInTheDocument();

    // Cancelling leaves nothing of it behind, on the page or in the next dialog.
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("知识库正在被 AI 会话使用")).not.toBeInTheDocument();

    // The same for a document.
    fireEvent.click(screen.getByRole("button", { name: "knowledgePage.delete" }));
    const documentDialog = await screen.findByRole("dialog");
    expect(within(documentDialog).queryByText("知识库正在被 AI 会话使用")).not.toBeInTheDocument();
    fireEvent.click(within(documentDialog).getByRole("button", { name: "common.confirmDelete" }));
    expect(await within(documentDialog).findByText("知识库正在被 AI 会话使用")).toBeInTheDocument();
  });

  it("keeps the open base's documents when another base is deleted", async () => {
    // They were cleared and never loaded again (the selection did not change).
    renderClient();
    await waitFor(() => expect(screen.getByText("restart nginx")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("knowledgePage.deleteBaseAria:policies"));
    mocks.csrfFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("?id=")) return {};
      if (u.startsWith("/api/knowledge/")) return { knowledgeBase: { documents } };
      return { knowledgeBases: [bases[0]] };
    });
    fireEvent.click(await screen.findByRole("button", { name: /confirmDelete|common\.confirmDelete/ }));
    await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge?id=kb_2", { method: "DELETE" }));
    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith("success", "knowledgePage.baseDeleted"));
    expect(screen.getByText("restart nginx")).toBeInTheDocument();
  });

  it("searches on Enter, and says so when nothing matches", async () => {
    // Enter in the query box did nothing, and a search without hits left the panel as it was.
    renderClient();
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    mocks.csrfFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? { hits: [] } : { knowledgeBases: bases, knowledgeBase: { documents } });
    const box = screen.getByRole("searchbox", { name: "knowledgePage.queryLabel" });
    fireEvent.change(box, { target: { value: "restore postgres" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getByText("knowledgePage.noHits")).toBeInTheDocument());
    expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/knowledge", expect.objectContaining({ method: "POST" }));

    mocks.csrfFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { hits: [{ knowledgeBaseName: "runbooks", documentTitle: "restore", chunkIndex: 2, score: 7, content: "pg_restore …" }] }
        : { knowledgeBases: bases, knowledgeBase: { documents } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getByText("knowledgePage.hitScore:7")).toBeInTheDocument());
    expect(screen.queryByText("knowledgePage.noHits")).not.toBeInTheDocument();
  });

  it("empties the document list as soon as another base is chosen", async () => {
    // The previous base's documents stayed under the new base's name until the new list arrived.
    renderClient();
    await waitFor(() => expect(screen.getByText("restart nginx")).toBeInTheDocument());
    mocks.csrfFetch.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByText("policies"));
    expect(screen.queryByText("restart nginx")).not.toBeInTheDocument();
  });

  it("hides the delete affordance from a caller who cannot manage", async () => {
    renderClient(false);
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    expect(screen.queryByLabelText("knowledgePage.deleteBaseAria:runbooks")).toBeNull();
  });

  it("labels every field it asks for, and says which base a document goes into", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("knowledgePage.ingestTarget:runbooks")).toBeInTheDocument());
    // Each had only a placeholder: gone once something was typed.
    for (const label of ["knowledgePage.namePlaceholder", "knowledgePage.descPlaceholder", "knowledgePage.docTitlePlaceholder", "knowledgePage.docContentLabel", "knowledgePage.queryLabel"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // The dry run's scope is said: the chosen base.
    expect(screen.getByText("knowledgePage.searchScope:runbooks")).toBeInTheDocument();
  });

  it("asks for a base before a document, and searches every base while none exists", async () => {
    seed({ bases: [] });
    renderClient();
    await waitFor(() => expect(screen.getByText("knowledgePage.ingestNeedsBase")).toBeInTheDocument());
    expect(screen.getByLabelText("knowledgePage.docTitlePlaceholder")).toBeDisabled();
    expect(screen.getByText("knowledgePage.searchScopeAll")).toBeInTheDocument();
  });

  it("says a refused create in the panel it was asked from", async () => {
    renderClient();
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    mocks.csrfFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("A knowledge base with this name exists");
      return { knowledgeBases: bases, knowledgeBase: { documents } };
    });
    fireEvent.change(screen.getByLabelText("knowledgePage.namePlaceholder"), { target: { value: "runbooks" } });
    fireEvent.click(screen.getByRole("button", { name: "knowledgePage.create" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A knowledge base with this name exists");
    // In the bases panel, above its fields, not at the foot of the page.
    expect(alert.compareDocumentPosition(screen.getByLabelText("knowledgePage.namePlaceholder")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.compareDocumentPosition(screen.getByLabelText("knowledgePage.queryLabel")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
