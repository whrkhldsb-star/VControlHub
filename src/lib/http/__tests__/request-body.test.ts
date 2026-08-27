import { describe, expect, it } from "vitest";

import {
	requestContentLengthExceeds,
	requestContentLengthMissing,
} from "../request-body";

function req(headers: Record<string, string>): Request {
	return new Request("https://example.test/upload", {
		method: "POST",
		headers,
	});
}

describe("requestContentLengthExceeds", () => {
	it("is true only when a declared length is over the cap", () => {
		expect(requestContentLengthExceeds(req({ "content-length": "2048" }), 1024)).toBe(true);
		expect(requestContentLengthExceeds(req({ "content-length": "512" }), 1024)).toBe(false);
	});

	it("cannot reject an undeclared (chunked) body — that is why the missing check exists", () => {
		expect(requestContentLengthExceeds(req({}), 1024)).toBe(false);
	});
});

describe("requestContentLengthMissing", () => {
	it("is true when Content-Length is absent, non-numeric, or unsafe", () => {
		expect(requestContentLengthMissing(req({}))).toBe(true);
		expect(requestContentLengthMissing(req({ "content-length": "abc" }))).toBe(true);
		expect(requestContentLengthMissing(req({ "content-length": "1e9" }))).toBe(true);
		expect(requestContentLengthMissing(req({ "content-length": "99999999999999999999" }))).toBe(true);
	});

	it("is false for a valid declared length", () => {
		expect(requestContentLengthMissing(req({ "content-length": "0" }))).toBe(false);
		expect(requestContentLengthMissing(req({ "content-length": "4096" }))).toBe(false);
	});
});
