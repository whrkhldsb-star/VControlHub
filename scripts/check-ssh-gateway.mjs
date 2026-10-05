#!/usr/bin/env node
/** Exercise the real WebSocket routing and authentication boundary without credentials. */
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { setTimeout as delay } from "node:timers/promises";

export async function checkSshGateway(baseUrl, origin, timeoutMs = 5_000) {
  const target = new URL(baseUrl);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
    throw new Error("Gateway probe requires an HTTP/WebSocket URL without credentials or query parameters");
  }
  const allowed = new URL(origin);
  if (!['http:', 'https:'].includes(allowed.protocol) || allowed.username || allowed.password || allowed.search || allowed.hash || allowed.pathname !== '/') throw new Error("Gateway probe requires a configured HTTP origin");
  origin = allowed.origin;
  target.protocol = ['https:', 'wss:'].includes(target.protocol) ? 'wss:' : 'ws:';
  target.pathname = '/ssh';

  const probe = (probeOrigin, denied) => new Promise((resolve, reject) => {
    const socket = new WebSocket(target, { origin: probeOrigin, followRedirects: false, handshakeTimeout: timeoutMs });
    let sawAuthError = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(new Error(error)); else resolve();
    };
    const timer = setTimeout(() => finish("SSH gateway protocol probe timed out"), timeoutMs);
    socket.on('error', () => finish("SSH gateway WebSocket connection failed"));
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(denied && response.statusCode === 403 ? null : "SSH gateway returned an unexpected upgrade response");
    });
    socket.on('open', () => { if (denied) finish("SSH gateway accepted an unconfigured origin"); });
    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== 'error' || typeof message.data !== 'string' || !message.data) throw new Error();
        sawAuthError = true;
      } catch { finish("SSH gateway accepted an unauthenticated client or returned invalid protocol data"); }
    });
    socket.on('close', () => finish(!denied && sawAuthError ? null : "SSH gateway did not enforce its authentication boundary"));
  });
  await probe(`https://vcontrolhub-probe-${crypto.randomUUID()}.invalid`, true);
  await probe(origin, false);
}

async function main() {
  const origin = (process.env.SSH_WS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).find(Boolean);
  if (!origin) throw new Error("SSH_WS_ALLOWED_ORIGINS is missing; the gateway cannot accept browser terminals");
  const host = process.env.SSH_WS_HOST?.trim() || '127.0.0.1';
  const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = process.env.SSH_GATEWAY_CHECK_URL || `http://${bracketedHost}:${process.env.SSH_WS_PORT || '3001'}`;
  const waitMs = Number(process.env.SSH_GATEWAY_CHECK_WAIT_MS ?? 10_000);
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60_000) throw new Error("Invalid SSH_GATEWAY_CHECK_WAIT_MS");
  const deadline = Date.now() + waitMs;
  while (true) {
    try { await checkSshGateway(url, origin); break; }
    catch (error) { if (Date.now() >= deadline) throw error; await delay(500); }
  }
  console.log("SSH gateway passed WebSocket routing, origin rejection and unauthenticated-client rejection");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
