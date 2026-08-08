export class RequestBodyTooLargeError extends Error {
	readonly maxBytes: number;

	constructor(maxBytes: number) {
		super(`Request body exceeds ${maxBytes} bytes`);
		this.name = "RequestBodyTooLargeError";
		this.maxBytes = maxBytes;
	}
}

export const MAX_NON_FILE_FORM_BYTES = 1 * 1024 * 1024;

function declaredContentLength(request: Request): number | null {
	const raw = request.headers.get("content-length");
	if (!raw || !/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

/** Check a declared body length before parsers such as request.formData() buffer it. */
export function requestContentLengthExceeds(
	request: Request,
	maxBytes: number,
): boolean {
	const declared = declaredContentLength(request);
	return declared !== null && declared > maxBytes;
}

/** Read a raw request body while enforcing a hard in-memory byte limit. */
export async function readRequestBodyBuffer(
	request: Request,
	maxBytes: number,
): Promise<Buffer> {
	if (requestContentLengthExceeds(request, maxBytes)) {
		throw new RequestBodyTooLargeError(maxBytes);
	}
	if (!request.body) return Buffer.alloc(0);

	const reader = request.body.getReader();
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
				throw new RequestBodyTooLargeError(maxBytes);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	return Buffer.concat(chunks, totalBytes);
}
