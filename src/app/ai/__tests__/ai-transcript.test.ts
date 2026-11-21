import { describe, expect, it, vi } from "vitest";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildAiChatMessagePayload } from "@/lib/ai/chat-message-payload";
import { serializeConversation } from "@/lib/ai/service-serialize";
import { chatRequestSchema } from "@/lib/ai/schema";
import { exportConversationToMarkdown } from "../ai-export";
import { recoverChatDraft } from "../ai-retry";
import type { Message } from "../ai-types";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

describe("retrying a saved turn", () => {
  const question = "Review both files";
  const textFiles = [{ name: "notes.txt", content: "a".repeat(70_000) + "\n--- End of notes.txt ---\nmore" }];
  it("restores text into the attachment field and asks for local binary files after reload", () => {
    const payload = buildAiChatMessagePayload({ body: { content: question, imageUrls: ["https://fixture.test/a.png"],
      imageBase64: [{ mimeType: "application/pdf", data: "YWJj" }], fileAttachments: textFiles },
      conv: { messages: [] } as never, locale: "en", isVisionCapable: true });
    const stored = { content: payload.persistedText, toolCalls: payload.attachmentMetadata, imageUrls: JSON.stringify(payload.allImageUrls) } as Message;
    const { args, needsFiles } = recoverChatDraft(stored);
    expect(needsFiles).toBe(true);
    expect(args).toEqual({ content: question, fileAttachments: textFiles, imageUrls: ["https://fixture.test/a.png"], imageBase64: [] });
    expect(chatRequestSchema.safeParse(args).success).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("YWJj");
  });

  it("suppresses inline images in old history and carries their re-selection hint", () => {
    const date = new Date();
    const data = serializeConversation({ createdAt: date, updatedAt: date, messages: [{ role: "user", content: question,
      imageUrls: '["data:image/png;base64,secret","https://fixture.test/a.png"]', toolCalls: "[]", createdAt: date, hostedActions: [] }] } as never);
    expect(JSON.stringify(data)).not.toContain("base64");
    const retry = recoverChatDraft(data.messages[0]!);
    expect(retry.needsFiles).toBe(true);
    expect(retry.args.imageUrls).toEqual(["https://fixture.test/a.png"]);
  });

  it("recovers old formatted attachments while preserving ordinary user-authored file examples", () => {
    const block = "--- File: a.txt ---\nx\n--- End of a.txt ---";
    const legacy = (content: string) => recoverChatDraft({ content, imageUrls: "[]" } as Message);
    expect(legacy("review\n\n📎 附件内容：\n\n" + block).args).toMatchObject({ content: "review", fileAttachments: [{ name: "a.txt", content: "x" }] });
    expect(legacy(block).args.content).toBe(block);
    expect(legacy("（附件）").needsFiles).toBe(true);
  });
});

it("downloads every page in chronological order and identifies the tool role", async () => {
  const date = "2026-10-01T00:00:00.000Z";
  const rows = Array.from({ length: 501 }, (_, index) => ({ id: String(index), role: index === 0 ? "tool" : "user", content: "entry-" + index, createdAt: date }));
  const page = (messages: typeof rows, hasMore: boolean) => ({ conversation: { title: "history", model: "model", createdAt: date, messages }, hasMore });
  vi.mocked(csrfFetch).mockResolvedValueOnce(page(rows.slice(1), true)).mockResolvedValueOnce(page(rows.slice(0, 1), false));
  const createUrl = vi.fn((_blob: Blob) => "blob:fixture");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
  try {
    await exportConversationToMarkdown({ conversationId: "chat", providerName: "provider", t: (key) => key });
    const cursor = new URLSearchParams({ before: date, beforeId: "1" });
    expect(csrfFetch).toHaveBeenLastCalledWith("/api/ai/conversations/chat?" + cursor);
    const blob = createUrl.mock.calls[0]![0];
    const reader = new FileReader();
    const contents = new Promise<string>((resolve) => { reader.onload = () => resolve(String(reader.result)); });
    reader.readAsText(blob);
    const markdown = await contents;
    expect(markdown).toContain("search.category.tool:\n\nentry-0\n");
    expect([...markdown.matchAll(/entry-(\d+)/g)].map((m) => Number(m[1]))).toEqual(rows.map((_, i) => i));
    expect(click).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
    click.mockRestore();
  }
});
