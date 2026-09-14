// @vitest-environment node
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeProviderChatStream } from "../chat-stream";

const encoder = new TextEncoder();
const content = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("provider stream lifecycle", () => {
  it.each([
    ["OPENAI", "data: [DONE]\n\n"],
    ["ANTHROPIC", 'data: {"type":"message_stop"}\n\n'],
  ])("releases a real HTTP connection at the %s terminal event", async (providerType, terminal) => {
    let closed = false;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(terminal);
      response.on("close", () => { closed = true; });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    const result = await consumeProviderChatStream({
      body: response.body!, providerType, onEvent: vi.fn(), timeoutMs: 500,
    });
    expect(result.readError).toBeUndefined();
    expect(response.body!.locked).toBe(false);
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it("stops at DONE even when more content shares the transport chunk", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(encoder.encode(content + "data: [DONE]\n\n" + content));
      c.close();
    } });
    const result = await consumeProviderChatStream({ body, providerType: "OPENAI", onEvent: vi.fn() });
    expect(result.content).toBe("partial");
    expect(body.locked).toBe(false);
  });

  it("returns consumer failures and cancels the upstream instead of swallowing them as malformed JSON", async () => {
    const cancel = vi.fn();
    const failure = new Error("downstream closed");
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(encoder.encode(content)); }, cancel,
    });
    const result = await consumeProviderChatStream({
      body, providerType: "OPENAI", onEvent: () => { throw failure; }, timeoutMs: 50,
    });
    expect(result.readError).toBe(failure);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("does not dispatch a buffered fragment after cancellation", async () => {
    const abort = new AbortController();
    const onEvent = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(encoder.encode(content.trim())); }, cancel,
    });
    const pending = consumeProviderChatStream({ body, providerType: "OPENAI", onEvent, signal: abort.signal });
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    const result = await pending;
    expect(onEvent).not.toHaveBeenCalled();
    expect(result.readError).toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("reports provider SSE errors while retaining earlier output", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(encoder.encode(content + 'data: {"error":{"message":"capacity exhausted"}}\n\n'));
      c.close();
    } });
    const result = await consumeProviderChatStream({ body, providerType: "OPENAI", onEvent: vi.fn() });
    expect(result.content).toBe("partial");
    expect(result.readError).toEqual(new Error("AI provider stream failed: capacity exhausted"));
  });

  it("bounds an unterminated line and cancels its source", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(encoder.encode("data: " + "x".repeat(1024 * 1024))); }, cancel,
    });
    const result = await consumeProviderChatStream({ body, providerType: "OPENAI", onEvent: vi.fn(), timeoutMs: 50 });
    expect(result.readError).toEqual(new Error("AI provider stream event is too large"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
