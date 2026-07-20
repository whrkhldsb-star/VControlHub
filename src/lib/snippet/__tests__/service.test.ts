import { beforeEach, describe, expect, it, vi } from "vitest";

type SnippetRow = { id: string; createdBy: string | null };

const state = {
  snippet: { id: "snippet-1", createdBy: "user-1" } as SnippetRow | null,
  createCalls: [] as Array<{ data: Record<string, unknown> }>,
  updateCalls: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  deleteCalls: [] as Array<{ where: { id: string } }>,
};

vi.mock("@/lib/db", () => ({
  prisma: {
    snippet: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        state.createCalls.push({ data });
        return { id: "snippet-1", ...data };
      },
      findUnique: () => Promise.resolve(state.snippet),
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.updateCalls.push({ where, data });
        return { id: where.id, ...data };
      },
      delete: ({ where }: { where: { id: string } }) => {
        state.deleteCalls.push({ where });
        return { id: where.id };
      },
      findMany: () => Promise.resolve([]),
    },
  },
}));

import { createSnippet, deleteSnippet, updateSnippet } from "@/lib/snippet/service";

describe("snippet service", () => {
  beforeEach(() => {
    state.snippet = { id: "snippet-1", createdBy: "user-1" };
    state.createCalls = [];
    state.updateCalls = [];
    state.deleteCalls = [];
  });

  describe("createSnippet — input normalization", () => {
    it("rejects an empty title", async () => {
      await expect(
        createSnippet({ title: "  ", content: "x" }),
      ).rejects.toThrow(/Snippet title and content cannot be empty/);
    });

    it("rejects an empty content", async () => {
      await expect(
        createSnippet({ title: "t", content: "" }),
      ).rejects.toThrow(/Snippet title and content cannot be empty/);
    });

    it("trims title/description, defaults language to 'text'", async () => {
      await createSnippet({
        title: "  hello  ",
        content: "console.log(1)",
        language: "  ",
        description: "  desc  ",
        isPrivate: true,
        createdBy: "user-1",
      });
      const data = state.createCalls[0]!.data;
      expect(data.title).toBe("hello");
      expect(data.language).toBe("text");
      expect(data.description).toBe("desc");
      expect(data.isPrivate).toBe(true);
      expect(data.createdBy).toBe("user-1");
    });

    it("deduplicates tags and drops empty ones", async () => {
      await createSnippet({
        title: "t",
        content: "c",
        tags: ["  a  ", "a", "", "b"],
      });
      expect(state.createCalls[0]!.data.tags).toEqual(["a", "b"]);
    });

    it("caps tags at 20 entries", async () => {
      const tags = Array.from({ length: 25 }, (_, i) => `t${i}`);
      await createSnippet({ title: "t", content: "c", tags });
      expect(state.createCalls[0]!.data.tags).toHaveLength(20);
    });
  });

  describe("updateSnippet — access control", () => {
    it("rejects an empty title when title is provided", async () => {
      await expect(
        updateSnippet("snippet-1", { title: "   " }, { userId: "user-1" }),
      ).rejects.toThrow(/Snippet title cannot be empty/);
    });

    it("rejects an empty content when content is provided", async () => {
      await expect(
        updateSnippet("snippet-1", { content: "" }, { userId: "user-1" }),
      ).rejects.toThrow(/Snippet content cannot be empty/);
    });

    it("rejects when actor is not owner and has no canManageAll", async () => {
      state.snippet = { id: "snippet-1", createdBy: "user-1" };
      await expect(
        updateSnippet("snippet-1", { title: "new" }, { userId: "user-2" }),
      ).rejects.toThrow(/No permission to modify/);
    });

    it("allows when actor is owner", async () => {
      await updateSnippet("snippet-1", { title: "new" }, { userId: "user-1" });
      expect(state.updateCalls).toHaveLength(1);
      expect(state.updateCalls[0]!.where).toEqual({ id: "snippet-1" });
    });

    it("allows when actor has canManageAll", async () => {
      await updateSnippet("snippet-1", { title: "new" }, {
        userId: "user-2",
        canManageAll: true,
      });
      expect(state.updateCalls).toHaveLength(1);
    });

    it("no-ops when no fields are provided (does not call update)", async () => {
      await updateSnippet("snippet-1", {}, { userId: "user-1" });
      expect(state.updateCalls).toHaveLength(0);
    });

    it("404s when the snippet does not exist", async () => {
      state.snippet = null;
      await expect(
        updateSnippet("missing", { title: "x" }, { userId: "user-1" }),
      ).rejects.toThrow(/不存在|not found/);
    });
  });

  describe("deleteSnippet — access control", () => {
    it("rejects when actor is not owner", async () => {
      state.snippet = { id: "snippet-1", createdBy: "user-1" };
      await expect(
        deleteSnippet("snippet-1", { userId: "user-2" }),
      ).rejects.toThrow(/No permission to delete/);
    });

    it("deletes when actor is owner", async () => {
      await deleteSnippet("snippet-1", { userId: "user-1" });
      expect(state.deleteCalls).toHaveLength(1);
    });

    it("deletes when actor has canManageAll", async () => {
      await deleteSnippet("snippet-1", { canManageAll: true });
      expect(state.deleteCalls).toHaveLength(1);
    });

    it("404s when the snippet does not exist", async () => {
      state.snippet = null;
      await expect(deleteSnippet("missing")).rejects.toThrow(/不存在|not found/);
    });
  });
});
