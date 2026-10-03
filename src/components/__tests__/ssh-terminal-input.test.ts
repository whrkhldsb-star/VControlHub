import { afterEach, expect, it, vi } from "vitest";
import { createSshTerminalInputSender } from "../ssh-terminal-input";
import { decodeBase64Bytes } from "../ssh-terminal-codec";

afterEach(() => { vi.useRealTimers(); });

function setup() {
	const socket = { readyState: 1 as const, bufferedAmount: 0, send: vi.fn() };
	const overflow = vi.fn();
	const sender = createSshTerminalInputSender(socket, overflow);
	return { socket, overflow, sender };
}

it("delivers a large Unicode paste and following keys in order with bounded frames", () => {
	const { socket, sender } = setup();
	const text = "中文🙂".repeat(40_000);
	sender.enqueue(text);
	sender.enqueue("\r\u0003");
	expect(socket.send).not.toHaveBeenCalled();
	sender.connected(true);
	const chunks: Uint8Array[] = [];
	for (let index = 0; index < socket.send.mock.calls.length; index++) {
		const raw = socket.send.mock.calls[index]![0] as string;
		expect(new TextEncoder().encode(raw).length).toBeLessThan(64 * 1024);
		const message = JSON.parse(raw);
		chunks.push(decodeBase64Bytes(message.data));
		const count = socket.send.mock.calls.length;
		sender.acknowledge(message.id + 1);
		expect(socket.send).toHaveBeenCalledTimes(count);
		sender.acknowledge(message.id);
	}
	const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	expect(new TextDecoder().decode(bytes)).toBe(text + "\r\u0003");
	sender.dispose();
});

it("waits for acknowledgements instead of flooding a slow SSH writer", () => {
	const { socket, sender } = setup();
	sender.connected(true);
	sender.enqueue("x".repeat(100_000));
	expect(socket.send).toHaveBeenCalledTimes(1);
	sender.enqueue("\r");
	expect(socket.send).toHaveBeenCalledTimes(1);
	sender.dispose();
	sender.acknowledge(1);
	expect(socket.send).toHaveBeenCalledTimes(1);
});

it("rejects an oversized paste atomically and keeps the shell usable", () => {
	const { socket, sender, overflow } = setup();
	sender.connected(true);
	expect(sender.enqueue("中".repeat(1_400_000))).toBe(false);
	expect(overflow).toHaveBeenCalledTimes(1);
	expect(socket.send).not.toHaveBeenCalled();
	expect(sender.enqueue("pwd\r")).toBe(true);
	expect(new TextDecoder().decode(decodeBase64Bytes(JSON.parse(socket.send.mock.calls[0]![0] as string).data))).toBe("pwd\r");
	sender.dispose();
});

it("paces legacy gateways and pauses when the browser transport is congested", async () => {
	vi.useFakeTimers();
	const { socket, sender } = setup();
	socket.bufferedAmount = 70_000;
	sender.connected(false);
	sender.enqueue("x".repeat(8_000));
	expect(socket.send).not.toHaveBeenCalled();
	socket.bufferedAmount = 0;
	await vi.advanceTimersByTimeAsync(125);
	expect(socket.send).toHaveBeenCalledTimes(1);
	expect(JSON.parse(socket.send.mock.calls[0]![0] as string).id).toBeUndefined();
	await vi.advanceTimersByTimeAsync(250);
	expect(socket.send).toHaveBeenCalledTimes(3);
	sender.dispose();
});

it("preserves split UTF-8 output bytes for xterm to decode as one stream", () => {
	const bytes = new TextEncoder().encode("中文🙂");
	const chunks = [bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5)];
	const decoder = new TextDecoder();
	const rendered = chunks.map(chunk => decoder.decode(decodeBase64Bytes(btoa(String.fromCharCode(...chunk))), { stream: true })).join("") + decoder.decode();
	expect(rendered).toBe("中文🙂");
});

it("recovers the send pipeline when an input-ack is lost", async () => {
	vi.useFakeTimers();
	const { socket, sender } = setup();
	sender.connected(true);
	sender.enqueue("ls\r");
	expect(socket.send).toHaveBeenCalledTimes(1);
	// No acknowledge() arrives — the ack is lost in transit.
	sender.enqueue("pwd\r");
	await vi.advanceTimersByTimeAsync(125);
	expect(socket.send).toHaveBeenCalledTimes(1); // still wedged...
	await vi.advanceTimersByTimeAsync(5_000);
	// ...until the ack deadline releases the pipeline and the queued key goes out.
	expect(socket.send).toHaveBeenCalledTimes(2);
	const message = JSON.parse(socket.send.mock.calls[1]![0] as string);
	expect(new TextDecoder().decode(decodeBase64Bytes(message.data))).toBe("pwd\r");
	// A late ack for the first chunk is ignored, but the fresh chunk still acks.
	sender.acknowledge(1);
	sender.acknowledge(2);
	sender.enqueue("echo ok\r");
	await vi.advanceTimersByTimeAsync(125);
	expect(socket.send).toHaveBeenCalledTimes(3);
	sender.dispose();
});
