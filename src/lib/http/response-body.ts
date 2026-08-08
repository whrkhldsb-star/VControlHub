export class ResponseBodyTooLargeError extends Error {
	readonly maxBytes: number;

	constructor(maxBytes: number) {
		super(`Response body exceeds ${maxBytes} bytes`);
		this.name = "ResponseBodyTooLargeError";
		this.maxBytes = maxBytes;
	}
}

type ReadableResponse = {
	headers: { get(name: string): string | null };
	body: {
		getReader(): {
			read(): Promise<{ done: boolean; value?: Uint8Array }>;
			cancel(reason?: unknown): Promise<void>;
			releaseLock(): void;
		};
	} | null;
};

/** Read an upstream response without allowing an untrusted host to fill memory. */
export async function readResponseTextLimited(
	response: ReadableResponse,
	maxBytes: number,
): Promise<string> {
	const rawLength = response.headers.get("content-length");
	if (rawLength && /^\d+$/.test(rawLength)) {
		const declaredLength = Number(rawLength);
		if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
			throw new ResponseBodyTooLargeError(maxBytes);
		}
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new ResponseBodyTooLargeError(maxBytes);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	return Buffer.concat(chunks, totalBytes).toString("utf8");
}
