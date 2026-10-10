import { afterEach, expect, it, vi } from "vitest";
import { createSshTerminalInputSender, INPUT_WINDOW_BYTES, INPUT_WINDOW_CHUNKS } from "../ssh-terminal-input";
import { decodeBase64Bytes } from "../ssh-terminal-codec";

afterEach(() => { vi.useRealTimers(); });

function setup() {
	const socket = { readyState: 1 as const, bufferedAmount: 0, send: vi.fn() };
	const overflow = vi.fn();
	const sender = createSshTerminalInputSender(socket, overflow);
	return { socket, overflow, sender };
}

function decodeSent(socket: { send: ReturnType<typeof vi.fn> }, index: number) {
	return JSON.parse(socket.send.mock.calls[index]![0] as string) as { data: string; id?: number };
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
		const message = decodeSent(socket, index);
		chunks.push(decodeBase64Bytes(message.data));
		// Acknowledge each chunk as it is read; the window refills behind it.
		sender.acknowledge(message.id);
	}
	const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	expect(new TextDecoder().decode(bytes)).toBe(text + "\r\u0003");
	sender.dispose();
});

it("sends keystrokes immediately while earlier chunks await their acks", () => {
	const { socket, sender } = setup();
	sender.connected(true);
	for (const key of ["l", "s", " ", "-", "l", "\r"]) sender.enqueue(key);
	expect(socket.send).toHaveBeenCalledTimes(6);
	expect(socket.send.mock.calls.map((_call, index) => decodeSent(socket, index).id)).toEqual([1, 2, 3, 4, 5, 6]);
	sender.dispose();
});

it("caps in-flight input and resumes as cumulative acks arrive", () => {
	const { socket, sender } = setup();
	sender.connected(true);
	sender.enqueue("x".repeat(200_000));
	const inFlightBytes = () => socket.send.mock.calls.reduce((size, _call, index) => size + decodeBase64Bytes(decodeSent(socket, index).data).length, 0);
	expect(inFlightBytes()).toBeLessThanOrEqual(INPUT_WINDOW_BYTES);
	expect(socket.send.mock.calls.length).toBeLessThanOrEqual(INPUT_WINDOW_CHUNKS);
	const sentBeforeAck = socket.send.mock.calls.length;
	sender.enqueue("\r");
	expect(socket.send).toHaveBeenCalledTimes(sentBeforeAck);
	// A stale or unknown ack releases nothing.
	sender.acknowledge(0);
	expect(socket.send).toHaveBeenCalledTimes(sentBeforeAck);
	// One cumulative ack for the whole window lets the next window go out.
	sender.acknowledge(decodeSent(socket, sentBeforeAck - 1).id);
	expect(socket.send.mock.calls.length).toBeGreaterThan(sentBeforeAck);
	sender.dispose();
	const afterDispose = socket.send.mock.calls.length;
	sender.acknowledge(afterDispose);
	expect(socket.send).toHaveBeenCalledTimes(afterDispose);
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

it("recovers the send window when input-acks are lost", async () => {
	vi.useFakeTimers();
	const { socket, sender } = setup();
	sender.connected(true);
	sender.enqueue("y".repeat(INPUT_WINDOW_BYTES));
	const windowSends = socket.send.mock.calls.length;
	// No acknowledge() arrives — the acks are lost in transit.
	sender.enqueue("pwd\r");
	await vi.advanceTimersByTimeAsync(125);
	expect(socket.send).toHaveBeenCalledTimes(windowSends); // window full...
	await vi.advanceTimersByTimeAsync(5_000);
	// ...until the ack deadline releases it and the queued key goes out.
	expect(socket.send).toHaveBeenCalledTimes(windowSends + 1);
	const message = decodeSent(socket, windowSends);
	expect(new TextDecoder().decode(decodeBase64Bytes(message.data))).toBe("pwd\r");
	// Late acks for the released chunks are ignored; the fresh chunk still acks.
	sender.acknowledge(1);
	sender.acknowledge(message.id);
	sender.enqueue("echo ok\r");
	expect(socket.send).toHaveBeenCalledTimes(windowSends + 2);
	sender.dispose();
});
