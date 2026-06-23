import { NextResponse } from "next/server";
import {
  sendChatRequest,
  createMessage,
  getConversationById,
} from "@/lib/ai/service";
import { chatRequestSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { getOpenAIToolsFormat } from "@/lib/ai/hosted-tools";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  parseToolCall,
  createHostedAction,
  executeSafeAction,
} from "@/lib/ai/hosted-service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const AI_CHAT_LIMIT = { maxRequests: 20, windowMs: 60_000 };

type HistoryMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content:
    | string
    | Array<{
        type: "text" | "image_url";
        text?: string;
        image_url?: { url: string; detail?: string };
      }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export async function POST(request: Request) {
  const locale = await getServerLocale();
  const rl = checkRateLimit(getClientIp(request), AI_CHAT_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: t("apiAiChat.rateLimited", locale) },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  return withApiRoute(
    request,
    { permission: "ai:chat", errorMessage: t("apiAiChat.errorMessage", locale) },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: t("apiAiChat.unauthorized", locale) },
          { status: 401 },
        );

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
        throw new ValidationError(t("apiAiChat.invalidRequest", locale));
      }

      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(t("apiAiChat.invalidInput", locale));
      }

      if (!body.conversationId || !body.content?.trim()) {
        throw new ValidationError(t("apiAiChat.missingParams", locale));
      }

      let conv: Awaited<ReturnType<typeof getConversationById>>;
      try {
        conv = await getConversationById(body.conversationId, session.userId);
      } catch {
        throw new NotFoundError(t("apiAiChat.conversationNotFound", locale));
      }

      const provider = conv.provider;
      const isVisionCapable = conv.enableVision;
      const isHostingEnabled = conv.hostingEnabled;

      // Build message history for the API
      const historyMessages: HistoryMessage[] = [];

      // System prompt
      if (conv.systemPrompt) {
        historyMessages.push({ role: "system", content: conv.systemPrompt });
      }

      // History
      for (const msg of conv.messages) {
        if (msg.role === "system") continue;

        // Tool call results (role=tool)
        if (msg.role === "tool") {
          historyMessages.push({
            role: "tool",
            content: msg.content,
            tool_call_id: msg.toolCallId || undefined,
          });
          continue;
        }

        // Assistant messages with tool calls
        const toolCallsData = JSON.parse(msg.toolCalls || "[]");
        if (msg.role === "assistant" && toolCallsData.length > 0) {
          historyMessages.push({
            role: "assistant",
            content: msg.content || "",
            tool_calls: toolCallsData,
          });
          continue;
        }

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
        historyMessages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }

      // Build the new user message content
      const userText = body.content.trim();
      const userImageUrls = body.imageUrls ?? [];
      const userImageBase64 = body.imageBase64 ?? [];
      const userFiles = body.fileAttachments ?? [];
      const hasImages =
        isVisionCapable &&
        (userImageUrls.length > 0 || userImageBase64.length > 0);
      const hasFiles = userFiles.length > 0;

      // Build text content including file attachments
      let fullText = userText;
      if (hasFiles) {
        const fileParts = userFiles
          .map(
            (f) =>
              `--- File: ${f.name} ---\n${f.content}\n--- End of ${f.name} ---`,
          )
          .join("\n\n");
        fullText = `${userText}${t("apiAiChat.attachmentPrefix", locale)}${fileParts}`;
      }

      if (hasImages) {
        const content: Array<{
          type: "text" | "image_url";
          text?: string;
          image_url?: { url: string; detail?: string };
        }> = [{ type: "text", text: fullText }];

        for (const url of userImageUrls) {
          content.push({ type: "image_url", image_url: { url } });
        }
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

      // Save user message
      const allImageUrls = [
        ...userImageUrls,
        ...userImageBase64.map(
          (img) => `data:${img.mimeType};base64,...(${img.data.length} chars)`,
        ),
      ];

      await createMessage({
        conversationId: conv.id,
        role: "user",
        content: userText,
        imageUrls: allImageUrls,
      });

      // Prepare tools if hosting is enabled
      const tools = isHostingEnabled ? getOpenAIToolsFormat() : undefined;

      // ── AI 请求 + Tool Calling 循环 ──────────────────────────────
      // 最多 5 轮 tool calling 循环，防止无限循环
      const MAX_TOOL_ROUNDS = 5;
      const currentMessages = [...historyMessages];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const allToolResults: Array<{
        toolCallId: string;
        toolName: string;
        result: unknown;
        needsApproval: boolean;
        actionId?: string;
      }> = [];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let chatResult: Awaited<ReturnType<typeof sendChatRequest>>;
        try {
          chatResult = await sendChatRequest(
            {
              providerId: provider.id,
              model: conv.model,
              messages: currentMessages,
              temperature: conv.temperature,
              max_tokens: conv.maxTokens,
              top_p: conv.topP,
              frequency_penalty: conv.frequencyPenalty,
              presence_penalty: conv.presencePenalty,
              stream: round === 0, // 只有第一轮用流式（直接返回给用户）
              tools,
            },
            session.userId,
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : t("apiAiChat.requestFailedFallback", locale);
          throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
        }

        // ── 第一轮：流式返回给客户端，同时检测 tool_calls ───────────
        if (round === 0) {
          const encoder = new TextEncoder();
          const startTime = chatResult.startTime;
          const providerType = chatResult.providerType;

          const stream = new ReadableStream({
            async start(controller) {
              let fullContent = "";
              let fullReasoning = "";
              let inputTokens = 0;
              let outputTokens = 0;
              const toolCalls: Array<{
                id: string;
                type: "function";
                function: { name: string; arguments: string };
              }> = [];

              try {
                const reader = chatResult.response.body?.getReader();
                if (!reader) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ error: t("apiAiChat.cannotReadStream", locale) })}\n\n`,
                    ),
                  );
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
                        if (
                          parsed.type === "content_block_delta" &&
                          parsed.delta?.delta?.text
                        ) {
                          fullContent += parsed.delta.delta.text;
                          controller.enqueue(
                            encoder.encode(
                              `data: ${JSON.stringify({ type: "content", content: parsed.delta.delta.text })}\n\n`,
                            ),
                          );
                        } else if (
                          parsed.type === "thinking_delta" &&
                          parsed.delta?.thinking
                        ) {
                          fullReasoning += parsed.delta.thinking;
                          controller.enqueue(
                            encoder.encode(
                              `data: ${JSON.stringify({ type: "reasoning", content: parsed.delta.thinking })}\n\n`,
                            ),
                          );
                        } else if (
                          parsed.type === "message_delta" &&
                          parsed.usage
                        ) {
                          outputTokens = parsed.usage.output_tokens ?? 0;
                        } else if (
                          parsed.type === "message_start" &&
                          parsed.message?.usage
                        ) {
                          inputTokens = parsed.message.usage.input_tokens ?? 0;
                        }
                        // Anthropic tool_use block
                        else if (
                          parsed.type === "content_block_start" &&
                          parsed.content_block?.type === "tool_use"
                        ) {
                          toolCalls.push({
                            id: parsed.content_block.id,
                            type: "function",
                            function: {
                              name: parsed.content_block.name,
                              arguments: "",
                            },
                          });
                        } else if (
                          parsed.type === "content_block_delta" &&
                          parsed.delta?.partial_json &&
                          toolCalls.length > 0
                        ) {
                          toolCalls[toolCalls.length - 1]!.function.arguments +=
                            parsed.delta.partial_json;
                        }
                      } else {
                        // OpenAI-compatible
                        const delta = parsed.choices?.[0]?.delta;

                        if (delta?.reasoning_content) {
                          fullReasoning += delta.reasoning_content;
                          controller.enqueue(
                            encoder.encode(
                              `data: ${JSON.stringify({ type: "reasoning", content: delta.reasoning_content })}\n\n`,
                            ),
                          );
                        } else if (delta?.content) {
                          fullContent += delta.content;
                          controller.enqueue(
                            encoder.encode(
                              `data: ${JSON.stringify({ type: "content", content: delta.content })}\n\n`,
                            ),
                          );
                        }

                        // OpenAI tool_calls in delta
                        if (delta?.tool_calls) {
                          for (const tc of delta.tool_calls as Array<{
                            index: number;
                            id?: string;
                            type?: string;
                            function?: { name?: string; arguments?: string };
                          }>) {
                            if (tc.id) {
                              // New tool call starting
                              toolCalls[tc.index] = {
                                id: tc.id,
                                type: "function",
                                function: {
                                  name: tc.function?.name || "",
                                  arguments: tc.function?.arguments || "",
                                },
                              };
                            } else if (toolCalls[tc.index]) {
                              // Continuing existing tool call
                              if (tc.function?.name)
                                toolCalls[tc.index]!.function.name +=
                                  tc.function.name;
                              if (tc.function?.arguments)
                                toolCalls[tc.index]!.function.arguments +=
                                  tc.function.arguments;
                            }
                          }
                        }

                        if (parsed.usage) {
                          inputTokens = parsed.usage.prompt_tokens ?? 0;
                          outputTokens = parsed.usage.completion_tokens ?? 0;
                        }
                      }
                    } catch {
                      /* skip malformed JSON */
                    }
                  }
                }
              } catch (err) {
                const errMsg =
                  err instanceof Error ? err.message : t("apiAiChat.streamErrorFallback", locale);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`,
                  ),
                );
              }

              // Save assistant message
              const latencyMs = Date.now() - startTime;
              totalInputTokens = inputTokens;
              totalOutputTokens = outputTokens;

              const assistantMsg = await prisma.aiMessage.create({
                data: {
                  conversationId: conv.id,
                  role: "assistant",
                  content: fullContent || t("apiAiChat.emptyContent", locale),
                  reasoningContent: fullReasoning || undefined,
                  toolCalls: JSON.stringify(toolCalls),
                  model: conv.model,
                  inputTokens,
                  outputTokens,
                  latencyMs,
                },
              });

              // ── 处理 tool_calls ────────────────────────────────
              if (toolCalls.length > 0 && isHostingEnabled) {
                // 发送 tool_call 事件给前端
                for (const tc of toolCalls) {
                  const parsed_tc = parseToolCall(tc);
                  if (parsed_tc) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "tool_call", toolCall: { id: tc.id, name: parsed_tc.tool.name, args: parsed_tc.args, riskLevel: parsed_tc.tool.riskLevel, autoApproved: parsed_tc.tool.autoApproved, actionName: parsed_tc.tool.actionName } })}\n\n`,
                      ),
                    );
                  }
                }

                // 执行每个 tool_call
                for (const tc of toolCalls) {
                  const parsed_tc = parseToolCall(tc);
                  if (!parsed_tc) continue;

                  const { tool, args, toolCallId } = parsed_tc;

                  // 创建托管操作记录
                  const action = await createHostedAction({
                    conversationId: conv.id,
                    messageId: assistantMsg.id,
                    toolCallId,
                    tool,
                    args,
                    userId: session.userId,
                  });
                  const actionParams = JSON.parse(action.params) as Record<string, unknown>;

                  if (tool.autoApproved) {
                    const execResult = await executeSafeAction(
                      {
                        actionType: tool.actionType,
                        serverId: action.serverId,
                        params: actionParams,
                      },
                      { session },
                    );

                    // 更新操作状态
                    await prisma.aiHostedAction.update({
                      where: { id: action.id },
                      data: {
                        status: execResult.success ? "COMPLETED" : "FAILED",
                        result: JSON.parse(
                          JSON.stringify(execResult.data || {}),
                        ),
                        errorMessage: execResult.error,
                        completedAt: new Date(),
                      },
                    });

                    // 保存 tool 结果消息
                    await prisma.aiMessage.create({
                      data: {
                        conversationId: conv.id,
                        role: "tool",
                        content: JSON.stringify(execResult),
                        toolCallId,
                      },
                    });

                    // 通知前端
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "tool_result", toolCallId, success: execResult.success, data: execResult.data, actionId: action.id })}\n\n`,
                      ),
                    );

                    allToolResults.push({
                      toolCallId,
                      toolName: tool.name,
                      result: execResult,
                      needsApproval: false,
                      actionId: action.id,
                    });
                  } else {
                    // 危险操作：需要审批
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "tool_approval_needed", toolCallId, actionId: action.id, actionName: tool.actionName, riskLevel: tool.riskLevel, params: actionParams })}\n\n`,
                      ),
                    );

                    allToolResults.push({
                      toolCallId,
                      toolName: tool.name,
                      result: t("apiAiChat.waitingForApproval", locale),
                      needsApproval: true,
                      actionId: action.id,
                    });
                  }
                }
              }

              // Signal completion
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "done",
                    inputTokens: totalInputTokens,
                    outputTokens: totalOutputTokens,
                    latencyMs: Date.now() - startTime,
                    toolResults: allToolResults,
                  })}\n\n`,
                ),
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

        // ── 后续轮次（非流式，处理 tool calling 循环）─────────
        // 后续轮次只在用户审批后通过 /api/ai/hosted-actions/[id]/approve 触发
        // 不在此处实现完整循环，避免长时间阻塞
        break;
      }

      // Fallback (should not reach here)
      throw new AppError({ code: "INTERNAL_ERROR", message: t("apiAiChat.unexpectedError", locale), status: 500 });
    },
  );
}
