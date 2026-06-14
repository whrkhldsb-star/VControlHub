import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  booleanFlagSchema,
  idQuerySchema,
  paginationQuerySchema,
  parseSearchParams,
  searchParamsToObject,
} from "../parse-search-params";

describe("searchParamsToObject", () => {
  it("把单值映射为 string", () => {
    const sp = new URLSearchParams("a=1&b=two");
    expect(searchParamsToObject(sp)).toEqual({ a: "1", b: "two" });
  });

  it("把重复键映射为 string[] (保序)", () => {
    const sp = new URLSearchParams("tag=a&tag=b&tag=c");
    expect(searchParamsToObject(sp)).toEqual({ tag: ["a", "b", "c"] });
  });

  it("混合单值和重复值", () => {
    const sp = new URLSearchParams("?page=1&tag=urgent&tag=bug");
    expect(searchParamsToObject(sp)).toEqual({ page: "1", tag: ["urgent", "bug"] });
  });

  it("空值保留为 \"\"", () => {
    const sp = new URLSearchParams("foo=");
    expect(searchParamsToObject(sp)).toEqual({ foo: "" });
  });

  it("空 searchParams 返回空对象", () => {
    expect(searchParamsToObject(new URLSearchParams())).toEqual({});
  });

  it("不修改入参", () => {
    const sp = new URLSearchParams("a=1&a=2");
    searchParamsToObject(sp);
    // URLSearchParams 自身的状态没被改
    expect(sp.getAll("a")).toEqual(["1", "2"]);
  });
});

describe("parseSearchParams", () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    q: z.string().trim().min(1).optional(),
    tag: z.union([z.string(), z.array(z.string())]).optional(),
  });

  it("通过 Request 解析合法 query", () => {
    const req = new Request("http://local/api/x?page=3&q=hello");
    const out = parseSearchParams(req, schema);
    expect(out).toEqual({ page: 3, q: "hello" });
  });

  it("通过 URL 解析合法 query", () => {
    const url = new URL("http://local/api/x?tag=urgent&tag=bug");
    const out = parseSearchParams(url, schema);
    expect(out).toMatchObject({ tag: ["urgent", "bug"] });
  });

  it("校验失败时抛带 code/status/details 的 Error", () => {
    const req = new Request("http://local/api/x?page=0");
    expect(() => parseSearchParams(req, schema)).toThrow();
    try {
      parseSearchParams(req, schema);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number; details?: unknown };
      expect(err.code).toBe("VALIDATION_FAILED");
      expect(err.status).toBe(400);
      expect(err.details).toMatchObject({ field: "query" });
    }
  });
});

describe("paginationQuerySchema", () => {
  it("默认值: page=1, pageSize=20, limit 缺省", () => {
    const out = paginationQuerySchema.parse({});
    expect(out).toEqual({ page: 1, pageSize: 20 });
  });

  it("字符串数字被自动 coerce", () => {
    const out = paginationQuerySchema.parse({ page: "5", pageSize: "50" });
    expect(out).toEqual({ page: 5, pageSize: 50, limit: undefined });
  });

  it("pageSize > 200 拒绝", () => {
    expect(() => paginationQuerySchema.parse({ pageSize: "999" })).toThrow();
  });

  it("page < 1 拒绝", () => {
    expect(() => paginationQuerySchema.parse({ page: "0" })).toThrow();
  });

  it("limit 可选,带上限", () => {
    const out = paginationQuerySchema.parse({ limit: "300" });
    expect(out.limit).toBe(300);
    expect(() => paginationQuerySchema.parse({ limit: "9999" })).toThrow();
  });
});

describe("idQuerySchema", () => {
  it("合法 id 通过", () => {
    expect(idQuerySchema.parse({ id: "abc-1" })).toEqual({ id: "abc-1" });
  });

  it("自动 trim", () => {
    expect(idQuerySchema.parse({ id: "  abc-1  " })).toEqual({ id: "abc-1" });
  });

  it("空字符串拒绝", () => {
    expect(() => idQuerySchema.parse({ id: "" })).toThrow();
    expect(() => idQuerySchema.parse({ id: "   " })).toThrow();
  });

  it("缺 id 拒绝", () => {
    expect(() => idQuerySchema.parse({})).toThrow();
  });
});

describe("booleanFlagSchema", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["yes", true],
    ["on", true],
    ["TRUE", true],
    ["0", false],
    ["false", false],
    ["no", false],
    ["off", false],
    ["", false],
    ["garbage", false],
  ])("\"%s\" → %s", (input, expected) => {
    expect(booleanFlagSchema.parse(input)).toBe(expected);
  });

  it("原 boolean 值透传", () => {
    expect(booleanFlagSchema.parse(true)).toBe(true);
    expect(booleanFlagSchema.parse(false)).toBe(false);
  });

  it("undefined → false", () => {
    expect(booleanFlagSchema.parse(undefined)).toBe(false);
  });
});
