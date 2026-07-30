import type { AiToolCall } from "./chat-message-payload";

type ProviderType = "ANTHROPIC" | string;

export type ChatStreamEvent =
  | { type: "content"; content: string }
  | { type: "reasoning"; content: string };

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

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolIndex(value: unknown, fallback: number): number {
  const index = numberValue(value);
  return index !== undefined && Number.isInteger(index) && index >= 0 ? index : fallback;
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
    const text = stringValue(delta?.text) || stringValue(record(delta?.delta)?.text);
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
      const index = toolIndex(event.index, Math.max(0, state.toolCalls.length - 1));
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
    state.outputTokens = numberValue(usage?.output_tokens) ?? state.outputTokens;
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
  state.outputTokens = numberValue(usage?.completion_tokens) ?? state.outputTokens;
}

export async function consumeProviderChatStream(input: {
  body: ReadableStream<Uint8Array>;
  providerType: ProviderType;
  onEvent: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<ChatStreamState> {
  const state: MutableChatStreamState = {
    content: "",
    reasoning: "",
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: [],
  };
  const reader = input.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (input.signal?.aborted) cancelReader();
  input.signal?.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    try {
      const event = record(JSON.parse(data));
      if (!event) return;
      if (input.providerType === "ANTHROPIC") {
        applyAnthropicEvent(event, state, input.onEvent);
      } else {
        applyOpenAiEvent(event, state, input.onEvent);
      }
    } catch {
      // A malformed provider chunk must not terminate an otherwise valid stream.
    }
  };

  let readError: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
  } catch (error) {
    readError = error;
  } finally {
    input.signal?.removeEventListener("abort", cancelReader);
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);

  return {
    ...state,
    toolCalls: state.toolCalls.filter((call): call is AiToolCall => Boolean(call)),
    readError,
  };
}
