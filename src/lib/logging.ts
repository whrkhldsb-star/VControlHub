type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|pwd|secret|token|authorization|cookie|private.?key|database.?url|dsn|credential|api.?key)/i;
const SECRET_VALUE_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s]+/i,
  /mysql:\/\/[^\s]+/i,
  /mongodb(?:\+srv)?:\/\/[^\s]+/i,
  /redis:\/\/[^\s]+/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /password\s*=\s*[^\s,;]+/i,
  /token\s*=\s*[^\s,;]+/i,
  /secret\s*=\s*[^\s,;]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i,
];

const MAX_DEPTH = 6;

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function redactSensitiveValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: process.env.NODE_ENV === "production" ? undefined : redactString(value.stack ?? ""),
    };
  }
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, "", depth + 1));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitiveValue(entryValue, entryKey, depth + 1)]),
    );
  }
  return redactString(String(value));
}

function emit(level: LogLevel, scope: string, message: string, errorOrContext?: unknown, context?: LogContext): void {
  if (level === "debug" && process.env.NODE_ENV === "production") return;

  const payload: Record<string, unknown> = {
    level,
    scope,
    message,
    timestamp: new Date().toISOString(),
  };

  if (errorOrContext instanceof Error) {
    payload.error = redactSensitiveValue(errorOrContext);
    if (context) payload.context = redactSensitiveValue(context);
  } else if (errorOrContext !== undefined) {
    payload.context = redactSensitiveValue(errorOrContext);
  }

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, context?: LogContext) => emit("debug", scope, message, context),
    info: (message: string, context?: LogContext) => emit("info", scope, message, context),
    warn: (message: string, context?: LogContext) => emit("warn", scope, message, context),
    error: (message: string, error?: unknown, context?: LogContext) => emit("error", scope, message, error, context),
  };
}

const defaultLogger = createLogger("app");

/** Log a handled, non-fatal error with production-safe redaction. */
export function logError(...args: unknown[]): void {
  const [first, ...rest] = args;
  if (first instanceof Error) defaultLogger.error("handled error", first, { args: rest });
  else defaultLogger.error(typeof first === "string" ? first : "handled error", undefined, { args: first === undefined ? rest : args });
}
