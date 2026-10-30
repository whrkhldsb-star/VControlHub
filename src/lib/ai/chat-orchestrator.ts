import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
import { t, type Locale } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import {
  buildAiChatMessagePayload,
  type AiToolCall,
} from "./chat-message-payload";
import { consumeProviderChatStream, type ChatStreamEvent } from "./chat-stream";
import {
  createHostedAction,
  executeSafeAction,
  parseToolCall,
} from "./hosted-service";
import { getOpenAIToolsFormat, toolAvailableInMode } from "./hosted-tools";
import { buildKnowledgeContextForPrompt } from "./knowledge";
import type { ChatRequestBody } from "./schema";
import { createMessage, getConversationById, sendChatRequest } from "./service";
import { detectModelCapabilities } from "./service-runtime";

const logger = createLogger("ai:chat");
const encoder = new TextEncoder();
/**
 * Stream watchdogs use idle semantics, not total duration: a healthy long
 * reply can stream for many minutes, and the old 90s/30s total caps truncated
 * it mid-sentence. A stall (no chunk for IDLE) or a hard hang (TOTAL) is still
 * bounded — 10 minutes comfortably exceeds any provider's max generation time.
 */
const PRIMARY_STREAM_IDLE_TIMEOUT_MS = 90_000;
const TOOL_FOLLOW_UP_IDLE_TIMEOUT_MS = 60_000;
const STREAM_TOTAL_TIMEOUT_MS = 10 * 60_000;

type ToolResult = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  needsApproval: boolean;
  actionId?: string;
};

function toolResultFallback(results: ToolResult[], locale: Locale): string {
  const summaries = results.map((item) => {
    const execution =
      item.result && typeof item.result === "object"
        ? (item.result as Record<string, unknown>)
        : undefined;
    const data =
      execution?.data && typeof execution.data === "object"
        ? (execution.data as Record<string, unknown>)
        : undefined;
    const templates = Array.isArray(data?.templates) ? data.templates : [];
    const templateNames = templates.flatMap((template) => {
      if (!template || typeof template !== "object") return [];
      const name = (template as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? [name.trim()] : [];
    });
    if (templateNames.length > 0) {
      return `${item.toolName}: ${templateNames.join(", ")}`;
    }
    const serialized =
      JSON.stringify(execution?.data ?? item.result) ?? String(item.result);
    return `${item.toolName}: ${serialized.length > 1200 ? `${serialized.slice(0, 1200)}...` : serialized}`;
  });
  const heading =
    locale === "zh" ? "工具执行完成，结果如下：" : "Tool execution completed:";
  return `${heading}\n\n${summaries.map((summary) => `- ${summary}`).join("\n")}`;
}

/**
 * Knowledge excerpts go in as a user turn right before the question, not as a
 * system message: they are documents other users uploaded, and a system
 * message would hand their contents the model's highest authority.
 */
export function insertKnowledgeContext<T extends { role: string }>(
  messages: T[],
  context: string,
  make: (content: string) => T = (content) => ({ role: "user", content }) as unknown as T,
): void {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") { lastUser = i; break; }
  }
  const entry = make(context);
  if (lastUser === -1) messages.push(entry);
  else messages.splice(lastUser, 0, entry);
}

function encodeSse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function isConversationDeletedDuringStream(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; meta?: unknown };
  if (candidate.code !== "P2003") return false;
  const detail = `${typeof candidate.message === "string" ? candidate.message : ""} ${JSON.stringify(candidate.meta ?? {})}`;
  return /ai_messages_conversationId_fkey|conversationId/i.test(detail);
}

async function processHostedTools(input: {
  toolCalls: AiToolCall[];
  conversationId: string;
  assistantMessageId: string;
  session: SessionPayload;
  locale: Locale;
  automationMode: "ASSISTED" | "PLAN_ONLY";
  send: (payload: unknown) => void;
}): Promise<ToolResult[]> {
  const parsedCalls = input.toolCalls.flatMap((toolCall) => {
    const parsed = parseToolCall(toolCall);
    return parsed ? [{ toolCall, parsed }] : [];
  });
  // Plan-only mode used to be no more than a shorter tool list shown to the model; a model that called a change
  // tool by name anyway got its action created. The mode is decided here, where the calls are run.
  const blockedCalls = parsedCalls.filter(({ parsed }) => !toolAvailableInMode(parsed.tool, input.automationMode));
  const runnableCalls = parsedCalls.filter((call) => !blockedCalls.includes(call));

  for (const { toolCall, parsed } of runnableCalls) {
    input.send({
      type: "tool_call",
      toolCall: {
        id: toolCall.id,
        name: parsed.tool.name,
        args: parsed.args,
        riskLevel: parsed.tool.riskLevel,
        autoApproved: parsed.tool.autoApproved,
        actionName: parsed.tool.actionName,
      },
    });
  }

  const results: ToolResult[] = [];
  // A call left without a result broke the thread: providers reject every
  // later request whose history holds an unanswered call. A call to a tool
  // that does not exist, or one that failed before its result was recorded,
  // is answered with the error, which the model then sees.
  const answerWithError = async (toolCallId: string, toolName: string, error: string) => {
    const execution = { success: false, data: null, error };
    await prisma.aiMessage.create({
      data: { conversationId: input.conversationId, role: "tool", content: JSON.stringify(execution), toolCallId },
    }).catch((recordError) => logger.warn("failed to record a tool call error", {
      toolCallId,
      error: recordError instanceof Error ? recordError.message : String(recordError),
    }));
    input.send({ type: "tool_result", toolCallId, success: false, data: null });
    results.push({ toolCallId, toolName, result: execution, needsApproval: false });
  };
  const parsedIds = new Set(parsedCalls.map(({ toolCall }) => toolCall.id));
  for (const toolCall of input.toolCalls) {
    if (parsedIds.has(toolCall.id)) continue;
    await answerWithError(toolCall.id, toolCall.function.name, t("apiAiChat.unknownTool", input.locale, { name: toolCall.function.name }));
  }
  for (const { toolCall, parsed } of blockedCalls) {
    await answerWithError(toolCall.id, parsed.tool.name, t("apiAiChat.toolUnavailableInPlanMode", input.locale, { name: parsed.tool.name }));
  }
  // Each action has dependent create/execute/update writes, so this loop is
  // intentionally sequential rather than a batch or Promise.all.
  for (const { parsed } of runnableCalls) {
    const { tool, args, toolCallId } = parsed;
    let answered = false;
    let actionId: string | null = null;
    try {
      const action = await createHostedAction({
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        toolCallId,
        tool,
        args,
        userId: input.session.userId,
        session: input.session,
      });
      actionId = action.id;
      const params = JSON.parse(action.params) as Record<string, unknown>;

      if (!tool.autoApproved) {
        await prisma.aiMessage.create({
          data: {
            conversationId: input.conversationId,
            role: "tool",
            content: JSON.stringify({
              actionId: action.id,
              status: "PENDING_APPROVAL",
              pendingApproval: true,
            }),
            toolCallId,
          },
        });
        answered = true;
        input.send({
          type: "tool_approval_needed",
          toolCallId,
          actionId: action.id,
          actionName: tool.actionName,
          actionType: tool.actionType,
          riskLevel: tool.riskLevel,
          params,
        });
        results.push({
          toolCallId,
          toolName: tool.name,
          result: t("apiAiChat.waitingForApproval", input.locale),
          needsApproval: true,
          actionId: action.id,
        });
        continue;
      }

      const execution = await executeSafeAction(
        { actionType: tool.actionType, serverId: action.serverId, params },
        { session: input.session, locale: input.locale },
      );
      await prisma.$transaction([
        prisma.aiHostedAction.update({
          where: { id: action.id },
          data: {
            status: execution.success ? "COMPLETED" : "FAILED",
            result: JSON.stringify(execution.data ?? null),
            errorMessage: execution.error,
            executedAt: new Date(),
            completedAt: new Date(),
          },
        }),
        prisma.aiMessage.create({
          data: {
            conversationId: input.conversationId,
            role: "tool",
            content: JSON.stringify(execution),
            toolCallId,
          },
        }),
      ]);
      answered = true;
      input.send({
        type: "tool_result",
        toolCallId,
        success: execution.success,
        data: execution.data,
        actionId: action.id,
      });
      results.push({
        toolCallId,
        toolName: tool.name,
        result: execution,
        needsApproval: false,
        actionId: action.id,
      });
    } catch (error) {
      logger.warn("hosted tool call failed", {
        toolCallId,
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!answered) {
        const message = error instanceof Error ? error.message : t("backend.ai.unknownError", input.locale);
        // The action row of a call that failed here would otherwise keep
        // showing as approved, never run.
        if (actionId) {
          await prisma.aiHostedAction.updateMany({
            where: { id: actionId, status: { in: ["APPROVED", "EXECUTING"] } },
            data: { status: "FAILED", errorMessage: message.slice(0, 2000), completedAt: new Date() },
          }).catch(() => undefined);
        }
        await answerWithError(toolCallId, tool.name, message);
      }
    }
  }
  return results;
}

function createStreamingResponse(input: {
  signal?: AbortSignal;
  upstream: Response;
  providerType: string;
  startTime: number;
  conversationId: string;
  model: string;
  hostingEnabled: boolean;
  automationMode: "ASSISTED" | "PLAN_ONLY";
  session: SessionPayload;
  locale: Locale;
  userMessageId: string;
  providerId: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content:
      | string
      | Array<{
          type: "text" | "image_url";
          text?: string;
          image_url?: { url: string; detail?: string };
        }>;
    tool_call_id?: string;
    tool_calls?: AiToolCall[];
  }>;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
}): Response {
  let cancelled = false;
  let consumerCancelled = false;
  let assistantPersisted = false;
  const abortController = new AbortController();
  const onRequestAbort = () => {
    cancelled = true;
    abortController.abort(input.signal?.reason);
  };
  if (input.signal?.aborted) onRequestAbort();
  else input.signal?.addEventListener("abort", onRequestAbort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(encodeSse(payload));
        } catch {
          cancelled = true;
          consumerCancelled = true;
          abortController.abort();
        }
      };
      const close = () => {
        if (!consumerCancelled) {
          cancelled = true;
          controller.close();
        }
      };

      try {
        if (!input.upstream.body) {
          await removeOrphanUserMessage(
            input.userMessageId,
            input.conversationId,
          );
          send({
            type: "error",
            error: t("apiAiChat.cannotReadStream", input.locale),
          });
          return;
        }

        const result = await consumeProviderChatStream({
          body: input.upstream.body,
          providerType: input.providerType,
          onEvent: (event: ChatStreamEvent) => send(event),
          signal: abortController.signal,
          idleTimeoutMs: PRIMARY_STREAM_IDLE_TIMEOUT_MS,
          totalTimeoutMs: STREAM_TOTAL_TIMEOUT_MS,
        });
        if (cancelled) {
          const persisted = await persistInterruptedAssistant(input);
          if (!persisted) {
            await removeOrphanUserMessage(
              input.userMessageId,
              input.conversationId,
            );
          }
          return;
        }
        if (result.readError) {
          send({
            type: "error",
            error: getErrorMessage(
              result.readError,
              t("apiAiChat.streamErrorFallback", input.locale),
            ),
          });
        }

        const assistant = await prisma.aiMessage.create({
          data: {
            conversationId: input.conversationId,
            role: "assistant",
            content:
              result.content ||
              (result.toolCalls.length > 0
                ? ""
                : t("apiAiChat.emptyContent", input.locale)),
            reasoningContent: result.reasoning || undefined,
            toolCalls: JSON.stringify(result.readError ? [] : result.toolCalls),
            model: input.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: Date.now() - input.startTime,
          },
        });
        assistantPersisted = true;
        // Partial text is useful history, but an interrupted tool request must
        // never execute or leave an unanswered tool call in the next prompt.
        if (result.readError || cancelled) return;
        const toolResults = input.hostingEnabled
          ? await processHostedTools({
              toolCalls: result.toolCalls,
              conversationId: input.conversationId,
              assistantMessageId: assistant.id,
              session: input.session,
              locale: input.locale,
              automationMode: input.automationMode,
              send,
            })
          : [];

        let finalInputTokens = result.inputTokens;
        let finalOutputTokens = result.outputTokens;
        if (
          result.toolCalls.length > 0 &&
          toolResults.length > 0 &&
          toolResults.every((toolResult) => !toolResult.needsApproval)
        ) {
          let followUpPersisted = false;
          try {
            const followUp = await sendChatRequest(
              {
                providerId: input.providerId,
                model: input.model,
                messages: [
                  ...input.messages,
                  {
                    role: "assistant",
                    content: result.content || "",
                    tool_calls: result.toolCalls,
                  },
                  ...toolResults.map((toolResult) => ({
                    role: "tool" as const,
                    content: JSON.stringify(toolResult.result),
                    tool_call_id: toolResult.toolCallId,
                  })),
                ],
                temperature: input.temperature,
                max_tokens: input.maxTokens,
                top_p: input.topP,
                frequency_penalty: input.frequencyPenalty,
                presence_penalty: input.presencePenalty,
                stream: true,
              },
              input.session.userId,
              abortController.signal,
            );
            if (followUp.response.body) {
              const followUpResult = await consumeProviderChatStream({
                body: followUp.response.body,
                providerType: followUp.providerType,
                onEvent: (event: ChatStreamEvent) => send(event),
                signal: abortController.signal,
                idleTimeoutMs: TOOL_FOLLOW_UP_IDLE_TIMEOUT_MS,
                totalTimeoutMs: STREAM_TOTAL_TIMEOUT_MS,
              });
              if (followUpResult.content || followUpResult.reasoning) {
                await prisma.aiMessage.create({
                  data: {
                    conversationId: input.conversationId,
                    role: "assistant",
                    content:
                      followUpResult.content ||
                      t("apiAiChat.emptyContent", input.locale),
                    reasoningContent: followUpResult.reasoning || undefined,
                    model: input.model,
                    inputTokens: followUpResult.inputTokens,
                    outputTokens: followUpResult.outputTokens,
                    latencyMs: Date.now() - followUp.startTime,
                  },
                });
                followUpPersisted = true;
              }
              if (followUpResult.readError) throw followUpResult.readError;
              finalInputTokens =
                (finalInputTokens ?? 0) + (followUpResult.inputTokens ?? 0);
              finalOutputTokens =
                (finalOutputTokens ?? 0) + (followUpResult.outputTokens ?? 0);
            }
          } catch (error) {
            logger.warn(
              "AI tool follow-up failed; keeping completed tool result",
              error,
              {
                conversationId: input.conversationId,
              },
            );
          }
          if (!followUpPersisted) {
            const fallback = toolResultFallback(toolResults, input.locale);
            send({ type: "content", content: fallback });
            await prisma.aiMessage.create({
              data: {
                conversationId: input.conversationId,
                role: "assistant",
                content: fallback,
                model: input.model,
                latencyMs: Date.now() - input.startTime,
              },
            });
          }
        }

        send({
          type: "done",
          inputTokens: finalInputTokens,
          outputTokens: finalOutputTokens,
          latencyMs: Date.now() - input.startTime,
          toolResults,
        });
      } catch (error) {
        if (cancelled) {
          const persisted = await persistInterruptedAssistant(input);
          if (!persisted) {
            await removeOrphanUserMessage(
              input.userMessageId,
              input.conversationId,
            );
          }
          return;
        }
        if (isConversationDeletedDuringStream(error)) {
          logger.info("AI conversation deleted before stream persistence completed", {
            conversationId: input.conversationId,
            userId: input.session.userId,
          });
          return;
        }
        logger.error("Failed to finalize AI chat stream", error, {
          conversationId: input.conversationId,
          userId: input.session.userId,
        });
        if (!assistantPersisted) {
          await removeOrphanUserMessage(
            input.userMessageId,
            input.conversationId,
          );
        }
        send({
          type: "error",
          error: getErrorMessage(
            error,
            t("apiAiChat.streamErrorFallback", input.locale),
          ),
        });
      } finally {
        input.signal?.removeEventListener("abort", onRequestAbort);
        close();
      }
    },
    cancel() {
      cancelled = true;
      consumerCancelled = true;
      abortController.abort();
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

async function persistInterruptedAssistant(input: {
  conversationId: string;
  model: string;
  locale: Locale;
}) {
  try {
    await prisma.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        role: "assistant",
        content: t("apiAiChat.streamInterrupted", input.locale),
        model: input.model,
      },
    });
    return true;
  } catch (error) {
    logger.error("Failed to persist interrupted AI message", error, {
      conversationId: input.conversationId,
    });
    return false;
  }
}

async function removeOrphanUserMessage(
  messageId: string,
  conversationId: string,
) {
  try {
    await prisma.aiMessage.deleteMany({
      where: { id: messageId, conversationId, role: "user" },
    });
  } catch (error) {
    logger.error("Failed to remove orphan AI user message", error, {
      conversationId,
      messageId,
    });
  }
}

export async function createAiChatResponse(input: {
  body: ChatRequestBody & { conversationId: string; content: string };
  session: SessionPayload;
  locale: Locale;
  signal?: AbortSignal;
}): Promise<Response> {
  input.signal?.throwIfAborted();
  let conversation: Awaited<ReturnType<typeof getConversationById>>;
  try {
    conversation = await getConversationById(
      input.body.conversationId,
      input.session.userId,
    );
  } catch {
    throw new NotFoundError(t("apiAiChat.conversationNotFound", input.locale));
  }

  const payload = buildAiChatMessagePayload({
    body: input.body,
    conv: conversation,
    // As the composer decides what it accepts: the model's own vision support,
    // or the conversation's explicit switch (for models detection misses).
    // Only the switch counted here, so images the page accepted and sent were
    // silently dropped on a vision model with the switch off.
    isVisionCapable: conversation.enableVision || detectModelCapabilities(conversation.model).vision,
    locale: input.locale,
  });
  const userMessage = await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: payload.persistedText,
    imageUrls: payload.allImageUrls,
  });

  const messages = [...payload.historyMessages];
  if (
    conversation.hostingEnabled &&
    conversation.automationMode === "PLAN_ONLY"
  ) {
    messages.unshift({
      role: "system",
      content:
        "Automation mode is PLAN_ONLY. Inspect read-only state and reusable command templates, explain the complete plan, final rendered command, target scope, verification, rollback, timing, and approval policy. Do not call direct mutation tools. Use create_automation_task only when the user asks to save or submit the reviewed plan; it still requires explicit confirmation.",
    });
  }
  try {
    const { context } = await buildKnowledgeContextForPrompt({
      query: payload.userText,
      session: input.session,
    });
    if (context) insertKnowledgeContext(messages, context);
  } catch (error) {
    logger.warn(
      "Knowledge retrieval failed; continuing without context",
      error,
      {
        conversationId: conversation.id,
      },
    );
  }

  try {
    input.signal?.throwIfAborted();
    const chat = await sendChatRequest(
      {
        providerId: conversation.provider.id,
        model: conversation.model,
        messages,
        temperature: conversation.temperature,
        max_tokens: conversation.maxTokens,
        top_p: conversation.topP,
        frequency_penalty: conversation.frequencyPenalty,
        presence_penalty: conversation.presencePenalty,
        stream: true,
        tools: conversation.hostingEnabled
          ? getOpenAIToolsFormat(conversation.automationMode)
          : undefined,
      },
      input.session.userId,
      ...(input.signal ? [input.signal] : []),
    );
    return createStreamingResponse({
      signal: input.signal,
      upstream: chat.response,
      providerType: chat.providerType,
      startTime: chat.startTime,
      conversationId: conversation.id,
      model: conversation.model,
      hostingEnabled: conversation.hostingEnabled,
      automationMode: conversation.automationMode,
      session: input.session,
      locale: input.locale,
      userMessageId: userMessage.id,
      providerId: conversation.provider.id,
      messages,
      temperature: conversation.temperature,
      maxTokens: conversation.maxTokens,
      topP: conversation.topP,
      frequencyPenalty: conversation.frequencyPenalty,
      presencePenalty: conversation.presencePenalty,
    });
  } catch (error) {
    await removeOrphanUserMessage(userMessage.id, conversation.id);
    throw new AppError({
      code: "INTERNAL_ERROR",
      message: getErrorMessage(
        error,
        t("apiAiChat.requestFailedFallback", input.locale),
      ),
      status: 500,
    });
  }
}
