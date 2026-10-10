/**
 * Read at most `maxBytes` of a text response and cancel the rest of the
 * download. Previews only show the beginning of a file, and a multi-GiB log
 * read with `response.text()` would download all of it and freeze the tab.
 *
 * When truncated, an incomplete trailing UTF-8 sequence and the final partial
 * line are dropped so tables and Markdown never render a half row.
 */
export async function readTextPrefix(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
	if (!response.body) {
		const text = await response.text();
		const bytes = new TextEncoder().encode(text);
		if (bytes.length <= maxBytes) return { text, truncated: false };
		return { text: dropPartialLine(new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true })), truncated: true };
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let text = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return { text: text + decoder.decode(), truncated: false };
			const room = maxBytes - received;
			if (value.byteLength > room) {
				// stream: true keeps an incomplete character buffered; it is never flushed.
				text += decoder.decode(value.subarray(0, room), { stream: true });
				await reader.cancel().catch(() => undefined);
				return { text: dropPartialLine(text), truncated: true };
			}
			text += decoder.decode(value, { stream: true });
			received += value.byteLength;
		}
	} finally {
		reader.releaseLock?.();
	}
}

function dropPartialLine(text: string): string {
	const lastBreak = text.lastIndexOf("\n");
	return lastBreak >= 0 ? text.slice(0, lastBreak + 1) : text;
}

/** Preview budgets: text and Markdown show the first 1 MiB, tables the first 2 MiB. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
