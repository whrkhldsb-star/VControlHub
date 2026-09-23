import type { AiToolCall } from "./chat-message-payload";

type ProviderType = "ANTHROPIC" | string;

export type ChatStreamEvent =
  { type: "content"; content: string } | { type: "reasoning"; content: string };

export type ChatStreamState = {
  content: string;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: AiToolCall[];
  readError?: unknown;
};

type MutableChatStreamState = Omit<ChatStreamState, "toolCalls"> & {
  toolCalls: Array<AiToolCall | undefined>;
};

type JsonRecord = Record<string, unknown>;

const MAX_EVENT_CHARS = 1024 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_INDEX = 1023;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toolIndex(value: unknown, fallback: number): number {
  const index = numberValue(value);
  if ((index ?? fallback) > MAX_TOOL_INDEX) {
    throw new Error("AI provider returned too many tool calls");
  }
  return index !== undefined && Number.isInteger(index) && index >= 0
    ? index
    : fallback;
}

function applyAnthropicEvent(
  event: JsonRecord,
  state: MutableChatStreamState,
  emit: (event: ChatStreamEvent) => void,
): void {
  const type = stringValue(event.type);
  const delta = record(event.delta);

  if (type === "content_block_delta") {
    // Support the official Anthropic shape (`delta.text`) and the nested shape
    // returned by some compatible gateways (`delta.delta.text`).
    const text =
      stringValue(delta?.text) || stringValue(record(delta?.delta)?.text);
    if (text) {
      state.content += text;
      emit({ type: "content", content: text });
    }

    const thinking = stringValue(delta?.thinking);
    if (thinking) {
      state.reasoning += thinking;
      emit({ type: "reasoning", content: thinking });
    }

    const partialJson = stringValue(delta?.partial_json);
    if (partialJson) {
      const index = toolIndex(
        event.index,
        Math.max(0, state.toolCalls.length - 1),
      );
      const call = state.toolCalls[index];
      if (call) call.function.arguments += partialJson;
    }
    return;
  }

  // Keep compatibility with gateways that expose thinking as a top-level event.
  if (type === "thinking_delta") {
    const thinking = stringValue(delta?.thinking);
    if (thinking) {
      state.reasoning += thinking;
      emit({ type: "reasoning", content: thinking });
    }
    return;
  }

  if (type === "content_block_start") {
    const block = record(event.content_block);
    if (block?.type === "tool_use") {
      const index = toolIndex(event.index, state.toolCalls.length);
      const initialInput = record(block.input);
      state.toolCalls[index] = {
        id: stringValue(block.id),
        type: "function",
        function: {
          name: stringValue(block.name),
          arguments:
            initialInput && Object.keys(initialInput).length > 0
              ? JSON.stringify(initialInput)
              : "",
        },
      };
    }
    return;
  }

  if (type === "message_start") {
    const usage = record(record(event.message)?.usage);
    state.inputTokens = numberValue(usage?.input_tokens) ?? state.inputTokens;
  } else if (type === "message_delta") {
    const usage = record(event.usage);
    state.outputTokens =
      numberValue(usage?.output_tokens) ?? state.outputTokens;
  }
}

function applyOpenAiEvent(
  event: JsonRecord,
  state: MutableChatStreamState,
  emit: (event: ChatStreamEvent) => void,
): void {
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const delta = record(record(choices[0])?.delta);
  const reasoning = stringValue(delta?.reasoning_content);
  const content = stringValue(delta?.content);

  if (reasoning) {
    state.reasoning += reasoning;
    emit({ type: "reasoning", content: reasoning });
  }
  if (content) {
    state.content += content;
    emit({ type: "content", content });
  }

  const deltas = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
  for (const value of deltas) {
    const toolCall = record(value);
    if (!toolCall) continue;
    const index = toolIndex(toolCall.index, state.toolCalls.length);
    const fn = record(toolCall.function);
    const id = stringValue(toolCall.id);
    if (id) {
      state.toolCalls[index] = {
        id,
        type: "function",
        function: {
          name: stringValue(fn?.name),
          arguments: stringValue(fn?.arguments),
        },
      };
      continue;
    }
    const current = state.toolCalls[index];
    if (current) {
      current.function.name += stringValue(fn?.name);
      current.function.arguments += stringValue(fn?.arguments);
    }
  }

  const usage = record(event.usage);
  state.inputTokens = numberValue(usage?.prompt_tokens) ?? state.inputTokens;
  state.outputTokens =
    numberValue(usage?.completion_tokens) ?? state.outputTokens;
}

export async function consumeProviderChatStream(input: {
  body: ReadableStream<Uint8Array>;
  providerType: ProviderType;
  onEvent: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  /**
   * Total-duration cap on the whole read. Long streaming replies legitimately
   * run for minutes, so callers should pass a generous value (or prefer
   * `idleTimeoutMs`) — a short total cap truncates healthy responses.
   */
  timeoutMs?: number;
  /**
   * Idle watchdog: abort when no chunk arrives for this long. The timer resets
   * on every received chunk, so a steadily-dripping stream is never cut while
   * a black-holed one is bounded.
   */
  idleTimeoutMs?: number;
  /** Alias for {@link timeoutMs}; both set means the larger one wins. */
  totalTimeoutMs?: number;
}): Promise<ChatStreamState> {
  const state: MutableChatStreamState = {
    content: "",
    reasoning: "",
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: [],
  };
  const reader = input.body.getReader();
  let timedOut = false;
  let stalled = false;
  let finished = false;
  let reachedEof = false;
  let receivedBytes = 0;
  let cancelRequested = false;
  const cancelReader = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    void reader.cancel().catch(() => undefined);
  };
  const totalTimeoutMs = Math.max(input.timeoutMs ?? 0, input.totalTimeoutMs ?? 0);
  const total = totalTimeoutMs
    ? setTimeout(() => {
        timedOut = true;
        cancelReader();
      }, totalTimeoutMs)
    : undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
  };
  const idleTimeoutMs = input.idleTimeoutMs ?? 0;
  const resetIdleTimer = () => {
    if (!idleTimeoutMs) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      stalled = true;
      cancelReader();
    }, idleTimeoutMs);
  };
  resetIdleTimer();
  if (input.signal?.aborted) cancelReader();
  input.signal?.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    if (line.length > MAX_EVENT_CHARS) {
      throw new Error("AI provider stream event is too large");
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    let event: JsonRecord | undefined;
    try {
      event = record(JSON.parse(data));
    } catch {
      // A malformed provider chunk must not terminate an otherwise valid stream.
      return;
    }
    if (!event) return;
    if (event.error || event.type === "error") {
      const message = stringValue(record(event.error)?.message).slice(0, 500);
      throw new Error(`AI provider stream failed${message ? `: ${message}` : ""}`);
    }
    if (input.providerType === "ANTHROPIC") {
      if (event.type === "message_stop") finished = true;
      else applyAnthropicEvent(event, state, input.onEvent);
    } else {
      applyOpenAiEvent(event, state, input.onEvent);
    }
  };

  let readError: unknown;
  try {
    while (!finished && !cancelRequested) {
      const { done, value } = await reader.read();
      if (cancelRequested) break;
      // Any read resolution is forward progress: re-arm the idle watchdog.
      resetIdleTimer();
      if (done) {
        reachedEof = true;
        buffer += decoder.decode();
        if (buffer) consumeLine(buffer);
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_STREAM_BYTES) {
        throw new Error("AI provider stream is too large");
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        consumeLine(line);
        if (finished || cancelRequested) break;
      }
      if (!finished && buffer.length > MAX_EVENT_CHARS) {
        throw new Error("AI provider stream event is too large");
      }
    }
  } catch (error) {
    readError = error;
  } finally {
    if (total) clearTimeout(total);
    clearIdleTimer();
    input.signal?.removeEventListener("abort", cancelReader);
    if (!reachedEof) cancelReader();
    reader.releaseLock();
  }
  if (stalled && !readError) {
    readError = new Error(
      `AI provider stream stalled for ${idleTimeoutMs / 1000} seconds without data`,
    );
  }
  if (timedOut && !readError) {
    readError = new Error(
      `AI provider stream timed out after ${totalTimeoutMs / 1000} seconds`,
    );
  }
  if (input.signal?.aborted && !readError) {
    readError = input.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }

  return {
    ...state,
    toolCalls: state.toolCalls.filter((call): call is AiToolCall =>
      Boolean(call),
    ),
    readError,
  };
}
