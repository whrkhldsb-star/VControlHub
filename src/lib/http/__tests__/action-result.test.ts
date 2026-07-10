import { describe, expect, it } from "vitest";
import {
  actionFail,
  actionOk,
  isActionFailure,
  isActionSuccess,
  toActionFailure,
  type ActionFailure,
  type ActionResult,
} from "../action-result";

describe("ActionResult constructors", () => {
  it("actionOk 生成 ok=true 结果", () => {
    const r = actionOk({ id: 1 }, { message: "已创建" });
    expect(r).toEqual({ ok: true, data: { id: 1 }, message: "已创建" });
    expect(isActionSuccess(r)).toBe(true);
    expect(isActionFailure(r)).toBe(false);
  });

  it("actionOk 不传 data 时不写入字段", () => {
    const r = actionOk();
    expect(r.ok).toBe(true);
    expect("data" in r).toBe(false);
  });

  it("actionFail 携带 code/message/details", () => {
    const r = actionFail("VALIDATION_FAILED", "校验失败", {
      details: { name: ["不能为空"] },
    });
    expect(r).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "校验失败",
      details: { name: ["不能为空"] },
    });
    expect(isActionFailure(r)).toBe(true);
    expect(isActionSuccess(r)).toBe(false);
  });

  it("actionFail 带 retryable + partial", () => {
    const r = actionFail("PARTIAL_FAILURE", "部分目标失败", {
      retryable: true,
      partial: [
        { id: "a", ok: true },
        { id: "b", ok: false, message: "超时" },
      ],
    });
    expect(r.retryable).toBe(true);
    expect(r.partial).toHaveLength(2);
  });
});

describe("toActionFailure", () => {
  it("zod-like ZodError (issues) → VALIDATION_FAILED + details", () => {
    const zodErr = {
      issues: [
        { path: ["name"], message: "不能为空" },
        { path: ["email"], message: "格式错误" },
        { path: ["name"], message: "至少 2 字符" },
      ],
    };
    const r = toActionFailure(zodErr);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("VALIDATION_FAILED");
    expect(r.message).toBe("Input validation failed");
    expect(r.details).toEqual({
      name: ["不能为空", "至少 2 字符"],
      email: ["格式错误"],
    });
  });

  it("zod-like ZodError (errors 别名) 也支持", () => {
    const zodErr = { errors: [{ path: ["x"], message: "bad" }] };
    const r = toActionFailure(zodErr);
    expect(r.code).toBe("VALIDATION_FAILED");
    expect(r.details).toEqual({ x: ["bad"] });
  });

  it("issues 项无 path 时归为 _", () => {
    const r = toActionFailure({ issues: [{ message: "global" }] });
    expect(r.details).toEqual({ _: ["global"] });
  });

  it("statusCode 401 → AUTH_REQUIRED", () => {
    const r = toActionFailure({ statusCode: 401 });
    expect(r.code).toBe("AUTH_REQUIRED");
  });

  it("statusCode 403 → FORBIDDEN", () => {
    const r = toActionFailure({ statusCode: 403 });
    expect(r.code).toBe("FORBIDDEN");
  });

  it("statusCode 404 → NOT_FOUND", () => {
    const r = toActionFailure({ statusCode: 404 });
    expect(r.code).toBe("NOT_FOUND");
  });

  it("statusCode 409 → CONFLICT", () => {
    const r = toActionFailure({ statusCode: 409 });
    expect(r.code).toBe("CONFLICT");
  });

  it("statusCode 429 → RATE_LIMITED + retryable", () => {
    const r = toActionFailure({ statusCode: 429 });
    expect(r.code).toBe("RATE_LIMITED");
    expect(r.retryable).toBe(true);
  });

  it("普通 Error → INTERNAL_ERROR + 透传 message", () => {
    const r = toActionFailure(new Error("数据库连接失败"));
    expect(r.code).toBe("INTERNAL_ERROR");
    expect(r.message).toBe("数据库连接失败");
  });

  it("空 Error → 默认文案", () => {
    const r = toActionFailure(new Error(""));
    expect(r.message).toBe("Operation failed");
  });

  it("非 Error 非对象 → 默认 INTERNAL_ERROR", () => {
    const r = toActionFailure("oops");
    expect(r.code).toBe("INTERNAL_ERROR");
    expect(r.message).toBe("Operation failed");
  });

  it("null/undefined → 默认 INTERNAL_ERROR", () => {
    expect(toActionFailure(null).code).toBe("INTERNAL_ERROR");
    expect(toActionFailure(undefined).code).toBe("INTERNAL_ERROR");
  });
});

describe("Type guards", () => {
  it("isActionSuccess narrow 正确", () => {
    const r: ActionResult<{ id: number }> = actionOk({ id: 5 });
    if (isActionSuccess(r)) {
      // 类型应包含 data
      expect(r.data?.id).toBe(5);
    } else {
      throw new Error("应为成功");
    }
  });

  it("isActionFailure narrow 正确", () => {
    const r: ActionResult = actionFail("FORBIDDEN", "不允许");
    if (isActionFailure(r)) {
      const failure: ActionFailure = r;
      expect(failure.code).toBe("FORBIDDEN");
    } else {
      throw new Error("应为失败");
    }
  });
});
