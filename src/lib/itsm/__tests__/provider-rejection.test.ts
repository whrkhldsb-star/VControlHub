import { describe, expect, it } from "vitest";

import { providerRejection } from "../adapters";

// DingTalk and Feishu robots answer HTTP 200 with an error code in the body
// (bad signature, keyword check, rate limit): the delivery failed.
describe("providerRejection", () => {
	it("reads DingTalk's errcode", () => {
		expect(providerRejection("dingtalk", '{"errcode":0,"errmsg":"ok"}')).toBeNull();
		expect(providerRejection("dingtalk", '{"errcode":310000,"errmsg":"sign not match"}')).toBe(
			"dingtalk rejected the message: 310000 sign not match",
		);
	});

	it("reads Feishu's code (and the older StatusCode)", () => {
		expect(providerRejection("feishu", '{"code":0,"msg":"success"}')).toBeNull();
		expect(providerRejection("feishu", '{"StatusCode":0,"StatusMessage":"success"}')).toBeNull();
		expect(providerRejection("feishu", '{"code":19021,"msg":"sign match fail"}')).toBe(
			"feishu rejected the message: 19021 sign match fail",
		);
		expect(providerRejection("feishu", '{"StatusCode":9499,"StatusMessage":"Bad Request"}')).toBe(
			"feishu rejected the message: 9499 Bad Request",
		);
	});

	it("does not judge other providers or bodies it cannot read", () => {
		expect(providerRejection("generic_webhook", '{"errcode":1}')).toBeNull();
		expect(providerRejection("dingtalk", "ok")).toBeNull();
	});
});
