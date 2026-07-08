/**
 * TR-002 R4 — 启动期 Direct Gateway 公网暴露探测
 *
 * 来源：TR-002 (Docker / QuickService / Direct Gateway 部署边界加固)
 *
 * 设计目标：
 * - 在 instrumentation.register() 启动后期 fire-and-forget 探测公网 IP:31888
 *   的 Direct Gateway 健康端点 (/__vch_health)，超时 3 秒，不阻塞启动。
 * - 若返回 HTTP 200，说明 direct gateway 服务在公网可达（部署者未把
 *   DIRECT_BIND 限制在 127.0.0.1，或上游反代/Caddy 没把 31888 限到内网），
 *   打 WARNING 提示检查 bind / 反代 / 防火墙。
 * - 网络错（连接拒绝 / 超时 / DNS 失败）→ 公网不可达 → 打 INFO 即可。
 * - 未配置 public host（开发环境 / 本地内网）→ 跳过探测，打 INFO。
 *
 * 范围限定：
 * - 仅做轻量 HTTP 探测，不做端口扫描 / 不做协议分析
 * - 不写 prisma / 不入队 jobs
 * - 探测函数本身是纯函数（fetch 可注入），便于测试
 *
 * 调用入口：src/instrumentation.ts 在 worker 启动后 fire-and-forget 调用
 * `scheduleDirectGatewayExposureProbe()`，把启动逻辑和探测逻辑解耦。
 */

import { createLogger } from "@/lib/logging";

const log = createLogger("direct-gateway-probe");

export const DIRECT_GATEWAY_DEFAULT_PORT = 31888;
export const DIRECT_GATEWAY_DEFAULT_HEALTH_PATH = "/__vch_health";
export const DIRECT_GATEWAY_PROBE_TIMEOUT_MS = 3000;

export type DirectGatewayExposureInput = {
  /** 公网可达的 IP / 域名 / 主机名；未传则用 process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST */
  publicHost?: string;
  /** Direct Gateway 监听端口；未传则用 process.env.DIRECT_PORT 或默认 31888 */
  port?: number;
  /** 健康检查路径；默认 /__vch_health */
  healthPath?: string;
  /** 超时毫秒数；默认 3000 */
  timeoutMs?: number;
  /** 注入 fetch 用于测试；默认用全局 fetch */
  fetchImpl?: typeof fetch;
};

export type DirectGatewayExposureResult = {
  /** 是否在公网可访问（HTTP 200） */
  exposed: boolean;
  /** 实际使用的 host（可能为 "(unknown)"） */
  host: string;
  /** 实际使用的 port */
  port: number;
  /** 探测路径（http://host:port/healthPath） */
  url: string;
  /** 结果说明：成功原因 / 失败错误 / 跳过原因 */
  reason: string;
  /** HTTP 状态码（探测成功时）；连接错时为 undefined */
  status?: number;
};

/**
 * TR-002 R4: 探测公网 IP:port 的 Direct Gateway 健康端点。
 *
 * 该函数是纯函数，不写日志、不修改全局状态。调用方拿到结果后可
 * 通过 `logDirectGatewayExposureResult()` 记录，或自行决定处理策略。
 */
export async function checkDirectGatewayPublicExposure(
  input: DirectGatewayExposureInput = {},
): Promise<DirectGatewayExposureResult> {
  const host = (input.publicHost ?? process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST ?? "").trim();
  const port =
    input.port ??
    (Number.parseInt(process.env.DIRECT_PORT ?? "", 10) || DIRECT_GATEWAY_DEFAULT_PORT);
  const healthPath = input.healthPath ?? DIRECT_GATEWAY_DEFAULT_HEALTH_PATH;
  const timeoutMs = input.timeoutMs ?? DIRECT_GATEWAY_PROBE_TIMEOUT_MS;
  const fetchFn = input.fetchImpl ?? fetch;

  if (!host) {
    return {
      exposed: false,
      host: "(unknown)",
      port,
      url: "",
      reason: "no public host configured (NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST is empty)",
    };
  }

  const url = `http://${host}:${port}${healthPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
      // 不带 body；尽量小开销
    });
    if (res.status === 200) {
      return { exposed: true, host, port, url, reason: `HTTP 200 from ${url}`, status: 200 };
    }
    return {
      exposed: false,
      host,
      port,
      url,
      reason: `HTTP ${res.status} from ${url} (not the public 31888 gateway)`,
      status: res.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err);
    return {
      exposed: false,
      host,
      port,
      url,
      reason: `connection failed: ${message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TR-002 R4: 把探测结果落到结构化日志。
 * - exposed=true → warn 级（部署者需要看）
 * - host=(unknown) → info 级（开发/本地，无须警告）
 * - 其它 → info 级（公网不可达或非 200 响应，部署基本安全）
 */
export function logDirectGatewayExposureResult(result: DirectGatewayExposureResult): void {
  if (result.exposed) {
    log.warn(
      "Direct Gateway is publicly reachable: detected HTTP 200 response (port 31888 listening on public network). Please check DIRECT_BIND / Caddy reverse proxy / firewall",
      { host: result.host, port: result.port, url: result.url, status: result.status },
    );
    return;
  }
  if (result.host === "(unknown)") {
    log.info("Direct Gateway public exposure probe skipped: no public host configured", { reason: result.reason });
    return;
  }
  log.info("Direct Gateway is not publicly exposed", { host: result.host, port: result.port, reason: result.reason });
}

/**
 * TR-002 R4: fire-and-forget 启动期探测。
 *
 * 设计：
 * - 不返回 Promise — 调用方不需要 await，启动路径不被阻塞
 * - 内部 setImmediate 把探测推到下一个事件循环 tick，避免阻塞 instrumentation 主路径
 * - 探测失败 / 异常 → log.error 记录，但绝不抛出
 */
export function scheduleDirectGatewayExposureProbe(
  input: DirectGatewayExposureInput = {},
): void {
  setImmediate(() => {
    checkDirectGatewayPublicExposure(input)
      .then((result) => {
        logDirectGatewayExposureResult(result);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Direct Gateway public exposure probe exception", { error: message.slice(0, 200) });
      });
  });
}
