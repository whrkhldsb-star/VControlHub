import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { sendChatRequest, createMessage, getConversationById } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chat
 *
 * Streams a chat completion response as SSE.
 * Also saves user + assistant messages to the conversation.
 *
 * Body: {
 * conversationId: string;
 * content: string;
 * imageUrls?: string[]; // URL-based images
 * imageBase64?: Array<{ // Base64-encoded images (from file upload)
 * mimeType: string;
 * data: string; // base64 data (without data: prefix)
 * }>;
 * fileAttachments?: Array<{ // Text file contents to inject
 * name: string;
 * content: string;
 * }>;
 * }
 */
export async function POST(request: Request) {
 const authed = await requireApiSession();
 if (authed instanceof NextResponse) return authed;
 const { session } = authed;

  let body: {
    conversationId: string;
    content: string;
    imageUrls?: string[];
    imageBase64?: Array<{ mimeType: string; data: string }>;
    fileAttachments?: Array<{ name: string; content: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  if (!body.conversationId || !body.content?.trim()) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  let conv: Awaited<ReturnType<typeof getConversationById>>;
  try {
    conv = await getConversationById(body.conversationId, session.userId);
  } catch {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const provider = conv.provider;
  const isVisionCapable = conv.enableVision;

  // Build message history for the API
  const historyMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string | Array<{
      type: "text" | "image_url";
      text?: string;
      image_url?: { url: string; detail?: string };
    }>;
  }> = [];

  // System prompt
  if (conv.systemPrompt) {
    historyMessages.push({ role: "system", content: conv.systemPrompt });
  }

  // History
  for (const msg of conv.messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user" && isVisionCapable) {
      const imgUrls: string[] = JSON.parse(msg.imageUrls || "[]");
      if (imgUrls.length > 0) {
        const content: Array<{
          type: "text" | "image_url";
          text?: string;
          image_url?: { url: string };
        }> = [{ type: "text", text: msg.content }];
        for (const u of imgUrls) {
          content.push({ type: "image_url", image_url: { url: u } });
        }
        historyMessages.push({ role: "user", content });
        continue;
      }
    }
    historyMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  // Build the new user message content
  const userText = body.content.trim();
  const userImageUrls = body.imageUrls ?? [];
  const userImageBase64 = body.imageBase64 ?? [];
  const userFiles = body.fileAttachments ?? [];
  const hasImages = isVisionCapable && (userImageUrls.length > 0 || userImageBase64.length > 0);
  const hasFiles = userFiles.length > 0;

  // Build text content including file attachments
  let fullText = userText;
  if (hasFiles) {
    const fileParts = userFiles
      .map((f) => `--- File: ${f.name} ---\n${f.content}\n--- End of ${f.name} ---`)
      .join("\n\n");
    fullText = `${userText}\n\n📎 附件内容:\n\n${fileParts}`;
  }

  if (hasImages) {
    // Multimodal message with text + images
    const content: Array<{
      type: "text" | "image_url";
      text?: string;
      image_url?: { url: string; detail?: string };
    }> = [{ type: "text", text: fullText }];

    // Add URL-based images
    for (const url of userImageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
    // Add base64-encoded images (from file upload)
    for (const img of userImageBase64) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      });
    }
    historyMessages.push({ role: "user", content });
  } else {
    historyMessages.push({ role: "user", content: fullText });
  }

  // Save user message (store all image URLs for history replay)
  const allImageUrls = [
    ...userImageUrls,
    ...userImageBase64.map((img) => `data:${img.mimeType};base64,...(${img.data.length} chars)`),
  ];

  await createMessage({
    conversationId: conv.id,
    role: "user",
    content: userText,
    imageUrls: allImageUrls,
  });

  // Send to AI provider (streaming)
  let chatResult: Awaited<ReturnType<typeof sendChatRequest>>;
  try {
    chatResult = await sendChatRequest(
      {
        providerId: provider.id,
        model: conv.model,
        messages: historyMessages,
        temperature: conv.temperature,
        max_tokens: conv.maxTokens,
        top_p: conv.topP,
        frequency_penalty: conv.frequencyPenalty,
        presence_penalty: conv.presencePenalty,
        stream: true,
      },
      session.userId
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI 请求失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Stream SSE response back to client
  const encoder = new TextEncoder();
  const startTime = chatResult.startTime;
  const providerType = chatResult.providerType;

  const stream = new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let fullReasoning = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const reader = chatResult.response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "无法读取响应流" })}\n\n`));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (providerType === "ANTHROPIC") {
                // ── Anthropic SSE format ──
                // event: content_block_delta → delta.delta.text
                // event: message_delta → delta.usage
                if (parsed.type === "content_block_delta" && parsed.delta?.delta?.text) {
                  fullContent += parsed.delta.delta.text;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "content", content: parsed.delta.delta.text })}\n\n`
                    )
                  );
                } else if (parsed.type === "thinking_delta" && parsed.delta?.thinking) {
                  fullReasoning += parsed.delta.thinking;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "reasoning", content: parsed.delta.thinking })}\n\n`
                    )
                  );
                } else if (parsed.type === "message_delta" && parsed.usage) {
                  outputTokens = parsed.usage.output_tokens ?? 0;
                } else if (parsed.type === "message_start" && parsed.message?.usage) {
                  inputTokens = parsed.message.usage.input_tokens ?? 0;
                }
              } else {
                // ── OpenAI-compatible SSE format ──
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.reasoning_content) {
                  fullReasoning += delta.reasoning_content;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "reasoning", content: delta.reasoning_content })}\n\n`
                    )
                  );
                } else if (delta?.content) {
                  fullContent += delta.content;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "content", content: delta.content })}\n\n`
                    )
                  );
                }

                // Capture usage if present
                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens ?? 0;
                  outputTokens = parsed.usage.completion_tokens ?? 0;
                }
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "流式传输错误";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`)
        );
      }

      // Save assistant message (always, even on error — partial content is valuable)
      const latencyMs = Date.now() - startTime;
      if (fullContent || fullReasoning) {
        await createMessage({
          conversationId: conv.id,
          role: "assistant",
          content: fullContent || "(无响应内容)",
          reasoningContent: fullReasoning || undefined,
          model: conv.model,
          inputTokens,
          outputTokens,
          latencyMs,
        });
      }

      // Signal completion
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "done",
            inputTokens,
            outputTokens,
            latencyMs,
          })}\n\n`
        )
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
