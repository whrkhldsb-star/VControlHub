/**
 * 统一操作反馈模型（TR-026）
 *
 * 沉淀共享的 ActionResult shape + 配套 toast 工具，避免每个页面重复实现
 * 排队成功 / 部分失败 / 可重试 / 权限失败 反馈。
 *
 * 推荐用法：
 *   server action / api route 返回 `ActionResult<T>`；
 *   client 用 `useActionResultToast()` 一行处理 toast。
 */

/** 成功结果 */
export type ActionSuccess<T = void> = {
  ok: true;
  data?: T;
  /** 任务中心链接（durable worker 入队成功时） */
  taskHref?: string;
  /** 显示给用户的成功文案；不传则 hook 内有默认 */
  message?: string;
};

/** 失败结果 */
export type ActionFailure = {
  ok: false;
  /** 错误码（前端按 code 分发，不再字符串匹配文案） */
  code:
    | "VALIDATION_FAILED"
    | "AUTH_REQUIRED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "RATE_LIMITED"
    | "PARTIAL_FAILURE"
    | "UPSTREAM_ERROR"
    | "INTERNAL_ERROR"
    | (string & {});
  /** 显示给用户的错误文案 */
  message: string;
  /** 字段级校验错误（VALIDATION_FAILED 用） */
  details?: Record<string, string[]> | unknown;
  /** 是否可重试（429 / 502 等） */
  retryable?: boolean;
  /** 部分失败时，附上每条子任务的状态 */
  partial?: Array<{ id: string; ok: boolean; message?: string }>;
};

export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

/** 服务端便捷构造器 */
export function actionOk<T = void>(
  data?: T,
  extra?: { message?: string; taskHref?: string },
): ActionSuccess<T> {
  return { ok: true, ...(data !== undefined ? { data } : {}), ...(extra ?? {}) };
}

export function actionFail(
  code: ActionFailure["code"],
  message: string,
  extra?: Pick<ActionFailure, "details" | "retryable" | "partial">,
): ActionFailure {
  return { ok: false, code, message, ...(extra ?? {}) };
}

/**
 * 将任意 thrown 值归一为 ActionFailure。
 * - zod ZodError → VALIDATION_FAILED + details
 * - 含 statusCode 401/403/404/409/429 → 对应 code
 * - 普通 Error → INTERNAL_ERROR
 * - 其它 → INTERNAL_ERROR + "未知错误"
 */
export function toActionFailure(err: unknown): ActionFailure {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;

    // zod 4 ZodError 兼容（issues 或 errors）
    const issues = (anyErr.issues ?? anyErr.errors) as
      | ReadonlyArray<{ path?: unknown; message?: unknown }>
      | undefined;
    if (Array.isArray(issues) && issues.length > 0) {
      const details: Record<string, string[]> = {};
      for (const issue of issues) {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "_";
        const msg = typeof issue.message === "string" ? issue.message : "Validation failed";
        details[path] = details[path] ?? [];
        details[path]!.push(msg);
      }
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Input validation failed",
        details,
      };
    }

    const status = typeof anyErr.statusCode === "number" ? anyErr.statusCode : undefined;
    if (status === 401) return { ok: false, code: "AUTH_REQUIRED", message: "Not logged in or session has expired" };
    if (status === 403) return { ok: false, code: "FORBIDDEN", message: "No permission to perform this operation" };
    if (status === 404) return { ok: false, code: "NOT_FOUND", message: "Resource does not exist or has been deleted" };
    if (status === 409) return { ok: false, code: "CONFLICT", message: "Resource state conflict" };
    if (status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "Too many requests; please retry later", retryable: true };
    }
  }

  if (err instanceof Error) {
    return { ok: false, code: "INTERNAL_ERROR", message: err.message || "Operation failed" };
  }
  return { ok: false, code: "INTERNAL_ERROR", message: "Operation failed" };
}

/** 类型守卫 */
export function isActionSuccess<T>(r: ActionResult<T>): r is ActionSuccess<T> {
  return r.ok === true;
}
export function isActionFailure<T>(r: ActionResult<T>): r is ActionFailure {
  return r.ok === false;
}
