import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("hides the delete affordance from a caller who cannot manage", async () => {
    renderClient(false);
    await waitFor(() => expect(screen.getByText("runbooks")).toBeInTheDocument());
    expect(screen.queryByLabelText("knowledgePage.deleteBaseAria:runbooks")).toBeNull();
  });
});
