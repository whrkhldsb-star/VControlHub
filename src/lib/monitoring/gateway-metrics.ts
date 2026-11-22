import { createHmac, timingSafeEqual } from "node:crypto";
import { isIPv6 } from "node:net";

/** The scraper connects locally when the gateway listens on a wildcard. */
export function gatewayMetricsUrl(host: string, port: number) {
  const address = host === "::" ? "::1" : host === "0.0.0.0" ? "127.0.0.1" : host;
  const authority = isIPv6(address) ? `[${address}]` : address;
  return new URL(`http://${authority}:${port}/metrics`);
}

/** A short-lived credential specific to this read-only endpoint. */
export function gatewayMetricsAuthorization(secret: string, now = Date.now()) {
  const stamp = Math.floor(now / 1000);
  const mac = createHmac("sha256", secret).update(`GET /metrics\n${stamp}`).digest("hex");
  return `Bearer ${stamp}.${mac}`;
}

export function mayScrapeGateway(authorization: string | undefined, secret: string | undefined, now = Date.now()) {
  const stamp = /^Bearer (\d{1,12})\.[a-f0-9]{64}$/.exec(authorization ?? "")?.[1];
  if (!authorization || !secret || !stamp || Math.abs(now / 1000 - Number(stamp)) > 30) return false;
  const expected = Buffer.from(gatewayMetricsAuthorization(secret, Number(stamp) * 1000));
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
