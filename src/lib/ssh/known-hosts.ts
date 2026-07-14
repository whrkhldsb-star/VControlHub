import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SshHostKeyChangedError } from "./host-key";

const runFile = promisify(execFile);

export function normalizeHostKeyFingerprint(value: string) {
  const trimmed = value.trim();
  return trimmed.replace(/^SHA256:/i, "SHA256:");
}

export function fingerprintKnownHostsLine(line: string): string | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3 || !parts[1]?.startsWith("ssh-") || !parts[2]) return null;
  try {
    const digest = createHash("sha256").update(Buffer.from(parts[2], "base64")).digest("base64").replace(/=+$/u, "");
    return `SHA256:${digest}`;
  } catch {
    return null;
  }
}

export function selectPinnedKnownHostsLine(scanOutput: string, expectedFingerprint: string) {
  const expected = normalizeHostKeyFingerprint(expectedFingerprint);
  const candidates = scanOutput.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const line of candidates) {
    if (fingerprintKnownHostsLine(line) === expected) return line;
  }
  const observed = candidates.map(fingerprintKnownHostsLine).filter((value): value is string => Boolean(value));
  throw new SshHostKeyChangedError(expected, observed.join(", ") || "no valid host key returned");
}

export async function scanPinnedKnownHost(input: { host: string; port: number; expectedFingerprint: string; timeoutMs?: number }) {
  const { stdout } = await runFile("ssh-keyscan", ["-p", String(input.port), "-T", String(Math.max(1, Math.ceil((input.timeoutMs ?? 10_000) / 1000))), input.host], {
    timeout: input.timeoutMs ?? 10_000,
    maxBuffer: 256 * 1024,
  });
  if (!stdout.trim()) throw new Error(`ssh-keyscan returned no host key for ${input.host}:${input.port}`);
  return selectPinnedKnownHostsLine(stdout, input.expectedFingerprint);
}
