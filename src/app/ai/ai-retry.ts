import type { Message } from "./ai-types";
import type { SendArgs } from "./hooks/use-ai-chat-stream";

export function recoverChatDraft(message: Message): { args: SendArgs; needsFiles: boolean } {
  const args: SendArgs = { content: message.content, imageUrls: [], imageBase64: [], fileAttachments: [] };
  try {
    const urls: unknown = JSON.parse(message.imageUrls);
    if (Array.isArray(urls)) args.imageUrls = urls.filter((url) => typeof url === "string" && /^https?:\/\//i.test(url));
    const metadata = JSON.parse(message.toolCalls || "[]");
    if (metadata?.version === 1) {
      args.content = message.content.slice(0, metadata.textLength);
      args.fileAttachments = metadata.ranges.map((file: { name: string; start: number; end: number }) => ({
        name: file.name, content: message.content.slice(file.start, file.end),
      }));
      return { args, needsFiles: !!message.requiresLocalFiles || metadata.localFiles > 0 };
    }
    // Legacy transcripts contain the rendered file blocks. Recover complete blocks only.
    const prefix = /\n\n📎 (?:Attachment contents:|附件内容：)\n\n/g.exec(message.content);
    if (prefix) {
      const attachments = message.content.slice(prefix.index + prefix[0].length);
      const blocks = [...attachments.matchAll(/^--- File: ([^\n]+) ---\n([\s\S]*?)\n--- End of \1 ---$/gm)];
      if (blocks.length) {
        args.content = message.content.slice(0, prefix.index);
        args.fileAttachments = blocks.map((block) => ({ name: block[1]!, content: block[2]! }));
      }
    }
    return { args, needsFiles: !!message.requiresLocalFiles || (Array.isArray(urls) && urls.length !== args.imageUrls.length) ||
      (/^(?:\(attachment\)|（附件）|\(附件\))$/i.test(args.content) && !args.fileAttachments.length && !args.imageUrls.length) };
  } catch {
    return { args, needsFiles: true };
  }
}
