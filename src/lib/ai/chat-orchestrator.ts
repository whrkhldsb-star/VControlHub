import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
import { t, type Locale } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { buildAiChatMessagePayload, type AiToolCall } from "./chat-message-payload";
import { consumeProviderChatStream, type ChatStreamEvent } from "./chat-stream";
import { createHostedAction, executeSafeAction, parseToolCall } from "./hosted-service";
import { getOpenAIToolsFormat } from "./hosted-tools";
import { buildKnowledgeContextForPrompt } from "./knowledge";
import type { ChatRequestBody } from "./schema";
import { createMessage, getConversationById, sendChatRequest } from "./service";

const logger = createLogger("ai:chat");
const encoder = new TextEncoder();

type ToolResult = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  needsApproval: boolean;
  actionId?: string;
};

function encodeSse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function processHostedTools(input: {
  toolCalls: AiToolCall[];
  conversationId: string;
  assistantMessageId: string;
  session: SessionPayload;
  locale: Locale;
  send: (payload: unknown) => void;
}): Promise<ToolResult[]> {
  const parsedCalls = input.toolCalls.flatMap((toolCall) => {
    const parsed = parseToolCall(toolCall);
    return parsed ? [{ toolCall, parsed }] : [];
  });

  for (const { toolCall, parsed } of parsedCalls) {
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
  // Each action has dependent create/execute/update writes, so this loop is
  // intentionally sequential rather than a batch or Promise.all.
  for (const { parsed } of parsedCalls) {
    const { tool, args, toolCallId } = parsed;
    const action = await createHostedAction({
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
      toolCallId,
      tool,
      args,
      userId: input.session.userId,
      session: input.session,
    });
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
  }
  return results;
}

function createStreamingResponse(input: {
  upstream: Response;
  providerType: string;
  startTime: number;
  conversationId: string;
  model: string;
  hostingEnabled: boolean;
  session: SessionPayload;
  locale: Locale;
  userMessageId: string;
}): Response {
  let cancelled = false;
  let assistantPersisted = false;
  const abortController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(encodeSse(payload));
        } catch {
          cancelled = true;
          abortController.abort();
        }
      };
      const close = () => {
        if (!cancelled) {
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
          send({ type: "error", error: t("apiAiChat.cannotReadStream", input.locale) });
          return;
        }

        const result = await consumeProviderChatStream({
          body: input.upstream.body,
          providerType: input.providerType,
          onEvent: (event: ChatStreamEvent) => send(event),
          signal: abortController.signal,
        });
        if (cancelled) {
          const persisted = await persistInterruptedAssistant(input);
          if (!persisted) {
            await removeOrphanUserMessage(input.userMessageId, input.conversationId);
          }
          return;
        }
        if (result.readError) {
          send({
            type: "error",
            error: getErrorMessage(result.readError, t("apiAiChat.streamErrorFallback", input.locale)),
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
            toolCalls: JSON.stringify(result.toolCalls),
            model: input.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: Date.now() - input.startTime,
          },
        });
        assistantPersisted = true;
        const toolResults = input.hostingEnabled
          ? await processHostedTools({
              toolCalls: result.toolCalls,
              conversationId: input.conversationId,
              assistantMessageId: assistant.id,
              session: input.session,
              locale: input.locale,
              send,
            })
          : [];

        send({
          type: "done",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - input.startTime,
          toolResults,
        });
      } catch (error) {
        if (cancelled) {
          const persisted = await persistInterruptedAssistant(input);
          if (!persisted) {
            await removeOrphanUserMessage(input.userMessageId, input.conversationId);
          }
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
          error: getErrorMessage(error, t("apiAiChat.streamErrorFallback", input.locale)),
        });
      } finally {
        close();
      }
    },
    cancel() {
      cancelled = true;
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
}): Promise<Response> {
  let conversation: Awaited<ReturnType<typeof getConversationById>>;
  try {
    conversation = await getConversationById(input.body.conversationId, input.session.userId);
  } catch {
    throw new NotFoundError(t("apiAiChat.conversationNotFound", input.locale));
  }

  const payload = buildAiChatMessagePayload({
    body: input.body,
    conv: conversation,
    isVisionCapable: conversation.enableVision,
    locale: input.locale,
  });
  const userMessage =
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: payload.userText,
    imageUrls: payload.allImageUrls,
  });

  const messages = [...payload.historyMessages];
  try {
    const { context } = await buildKnowledgeContextForPrompt({
      query: payload.userText,
      session: input.session,
      limit: 4,
    });
    if (context) messages.unshift({ role: "system", content: context });
  } catch (error) {
    logger.warn("Knowledge retrieval failed; continuing without context", error, {
      conversationId: conversation.id,
    });
  }

  try {
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
        tools: conversation.hostingEnabled ? getOpenAIToolsFormat() : undefined,
      },
      input.session.userId,
    );
    return createStreamingResponse({
      upstream: chat.response,
      providerType: chat.providerType,
      startTime: chat.startTime,
      conversationId: conversation.id,
      model: conversation.model,
      hostingEnabled: conversation.hostingEnabled,
      session: input.session,
      locale: input.locale,
      userMessageId: userMessage.id,
    });
  } catch (error) {
    await removeOrphanUserMessage(userMessage.id, conversation.id);
    throw new AppError({
      code: "INTERNAL_ERROR",
      message: getErrorMessage(error, t("apiAiChat.requestFailedFallback", input.locale)),
      status: 500,
    });
  }
}
