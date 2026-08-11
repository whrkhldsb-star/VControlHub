import { describe, expect, it, vi } from "vitest";

import { consumeProviderChatStream } from "../chat-stream";

const encoder = new TextEncoder();

function streamChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("consumeProviderChatStream", () => {
  it("assembles OpenAI content, reasoning, usage, and sparse tool-call deltas", async () => {
    const onEvent = vi.fn();
    const result = await consumeProviderChatStream({
      providerType: "OPENAI",
      body: streamChunks([
        'data: {"choices":[{"delta":{"reasoning_content":"check "}}]}\n',
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":2,"id":"call-2","function":{"name":"get_","arguments":"{\\"id\\":"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":2,"function":{"name":"server","arguments":"\\"srv-1\\"}"}}]}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n',
        "data: [DONE]\n\n",
      ]),
      onEvent,
    });

    expect(result).toEqual({
      content: "hello",
      reasoning: "check ",
      inputTokens: 7,
      outputTokens: 3,
      toolCalls: [
        {
          id: "call-2",
          type: "function",
          function: { name: "get_server", arguments: '{"id":"srv-1"}' },
        },
      ],
      readError: undefined,
    });
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "reasoning", content: "check " },
      { type: "content", content: "hello" },
    ]);
  });

  it("parses official Anthropic text, thinking, tool, and usage events across chunks", async () => {
    const onEvent = vi.fn();
    const result = await consumeProviderChatStream({
      providerType: "ANTHROPIC",
      body: streamChunks([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}\r\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}\n',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool-1","name":"list_servers","input":{}}}\n',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"status\\":\\"up\\"}"}}\n',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      ]),
      onEvent,
    });

    expect(result.content).toBe("answer");
    expect(result.reasoning).toBe("plan");
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(5);
    expect(result.toolCalls).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: { name: "list_servers", arguments: '{"status":"up"}' },
      },
    ]);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("keeps parsed output when the upstream reader fails", async () => {
    const upstreamError = new Error("upstream disconnected");
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n'),
          );
        } else {
          controller.error(upstreamError);
        }
      },
    });

    const result = await consumeProviderChatStream({
      providerType: "OPENAI_COMPATIBLE",
      body,
      onEvent: vi.fn(),
    });

    expect(result.content).toBe("partial");
    expect(result.readError).toBe(upstreamError);
  });

  it("cancels a provider stream that never finishes", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const result = await consumeProviderChatStream({
      providerType: "OPENAI",
      body,
      onEvent: vi.fn(),
      timeoutMs: 10,
    });

    expect(cancelled).toBe(true);
    expect(result.readError).toEqual(
      new Error("AI provider stream timed out after 0.01 seconds"),
    );
  });

  it("skips malformed chunks without dropping later valid events", async () => {
    const result = await consumeProviderChatStream({
      providerType: "OPENAI",
      body: streamChunks([
        "data: {not-json}\n",
        'data:{"choices":[{"delta":{"content":"ok"}}]}',
      ]),
      onEvent: vi.fn(),
    });

    expect(result.content).toBe("ok");
    expect(result.readError).toBeUndefined();
  });
});
