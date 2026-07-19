/**
 * k6 load baseline for VControlHub critical API paths.
 *
 * Run (requires k6 installed: https://k6.io):
 *   BASE_URL=http://127.0.0.1:3000 k6 run scripts/load/k6-baseline.js
 *   BASE_URL=https://example.com SESSION_COOKIE='vcontrolhub_session=...' k6 run scripts/load/k6-baseline.js
 *
 * Thresholds are intentionally conservative for a single-node VPS console.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";
const CSRF_TOKEN = __ENV.CSRF_TOKEN || "";

const authFailRate = new Rate("auth_surface_fail");
const protectedFailRate = new Rate("protected_surface_fail");
const loginLatency = new Trend("login_latency_ms", true);
const healthLatency = new Trend("health_latency_ms", true);

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    login_latency_ms: ["p(95)<1200"],
    health_latency_ms: ["p(95)<1500"],
    auth_surface_fail: ["rate<0.01"],
    // Protected endpoints without a cookie are expected to 401/403; treat unexpected 5xx as fail.
    protected_surface_fail: ["rate<0.02"],
  },
};

function headers(extra = {}) {
  const h = {
    Accept: "application/json",
    "User-Agent": "vcontrolhub-k6-baseline/1.0",
    ...extra,
  };
  if (SESSION_COOKIE) h.Cookie = SESSION_COOKIE;
  if (CSRF_TOKEN) h["x-csrf-token"] = CSRF_TOKEN;
  return h;
}

export default function () {
  group("public auth surface", () => {
    const login = http.get(`${BASE_URL}/login`, { headers: headers(), tags: { name: "GET /login" } });
    loginLatency.add(login.timings.duration);
    const ok = check(login, {
      "login status is 200": (r) => r.status === 200,
      "login body has form markers": (r) =>
        typeof r.body === "string" && /username|password|登录|Sign in/i.test(r.body),
    });
    authFailRate.add(!ok);
  });

  group("health", () => {
    const health = http.get(`${BASE_URL}/api/health`, {
      headers: headers(),
      tags: { name: "GET /api/health" },
    });
    healthLatency.add(health.timings.duration);
    check(health, {
      "health not 5xx": (r) => r.status < 500,
    });
  });

  group("protected APIs without/with session", () => {
    const servers = http.get(`${BASE_URL}/api/servers`, {
      headers: headers(),
      tags: { name: "GET /api/servers" },
    });
    const files = http.get(`${BASE_URL}/api/files`, {
      headers: headers(),
      tags: { name: "GET /api/files" },
    });
    const observability = http.get(`${BASE_URL}/api/monitoring/observability`, {
      headers: headers(),
      tags: { name: "GET /api/monitoring/observability" },
    });

    if (SESSION_COOKIE) {
      const ok =
        check(servers, { "servers with session <500": (r) => r.status < 500 }) &&
        check(files, { "files with session <500": (r) => r.status < 500 }) &&
        check(observability, { "observability with session <500": (r) => r.status < 500 });
      protectedFailRate.add(!ok);
    } else {
      const ok =
        check(servers, {
          "servers unauth is 401/403": (r) => r.status === 401 || r.status === 403,
        }) &&
        check(observability, {
          "observability unauth is 401/403": (r) => r.status === 401 || r.status === 403,
        });
      protectedFailRate.add(!ok);
    }
  });

  sleep(1);
}
