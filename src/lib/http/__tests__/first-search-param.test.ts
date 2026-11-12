import { describe, expect, it } from "vitest";

import { firstSearchParam, firstSearchParams } from "../first-search-param";

describe("page search parameters", () => {
	it("takes the first value of a parameter given more than once", () => {
		expect(firstSearchParam(undefined)).toBeUndefined();
		expect(firstSearchParam("a")).toBe("a");
		expect(firstSearchParam(["a", "b"])).toBe("a");
		expect(firstSearchParam([])).toBeUndefined();
	});

	it("does the same for a whole set of parameters", () => {
		expect(firstSearchParams({ q: ["cat", "dog"], type: "image", page: undefined })).toEqual({ q: "cat", type: "image" });
		expect(firstSearchParams(undefined)).toEqual({});
	});
});
