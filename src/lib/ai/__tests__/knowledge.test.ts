import { describe, expect, it } from "vitest";

import {
  chunkKnowledgeText,
  formatKnowledgeContext,
  hashKnowledgeContent,
  scoreChunkAgainstQuery,
} from "../knowledge";

describe("knowledge chunking & scoring", () => {
  it("hashes content stably", () => {
    expect(hashKnowledgeContent("hello")).toBe(hashKnowledgeContent("hello"));
    expect(hashKnowledgeContent("hello")).not.toBe(hashKnowledgeContent("hello!"));
  });

  it("chunks long text into overlapping pieces", () => {
    const body = "段落一：备份策略。\n\n" + ("恢复步骤详细说明。".repeat(80));
    const chunks = chunkKnowledgeText(body, { size: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
    expect(chunks.every((c) => c.searchText === c.content.toLowerCase())).toBe(true);
  });

  it("scores relevant chunks higher", () => {
    const query = "PostgreSQL 备份恢复";
    const tokens = ["postgresql", "备份", "恢复", "post", "gres"];
    const good = scoreChunkAgainstQuery(
      "postgresql 备份恢复流程：先校验 checksum，再执行 restore-db.sh",
      query,
      ["postgresql", "备份", "恢复"],
    );
    const bad = scoreChunkAgainstQuery("今日天气晴朗适合散步", query, ["postgresql", "备份", "恢复"]);
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThan(0);
    void tokens;
  });

  it("formats context with KB citations", () => {
    const text = formatKnowledgeContext([
      {
        chunkId: "c1",
        documentId: "d1",
        knowledgeBaseId: "k1",
        knowledgeBaseName: "Ops",
        documentTitle: "Backup SOP",
        chunkIndex: 0,
        content: "Always verify checksum.",
        score: 10,
      },
    ]);
    expect(text).toContain("[KB1]");
    expect(text).toContain("Backup SOP");
    expect(text).toContain("Always verify checksum.");
  });
});
