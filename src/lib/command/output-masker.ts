/**
 * Free-text secret masker and length bounder for remote command output returned
 * via GET /api/commands/[id], GET /api/ai/hosted-actions/[id], and AI tool
 * result write-back.
 *
 * Pure, dependency-free. Masks common tokens, private keys, basic-auth URLs,
 * and key=value secret assignments before returning or forwarding command output.
 */

const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // PEM private key blocks (multiline)
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED PRIVATE KEY]",
  ],
  // Authorization headers / Bearer tokens
  [
    /(\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s'",;]+/gi,
    "$1[REDACTED]",
  ],
  [
    /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
    "$1[REDACTED]",
  ],
  // Known API key / PAT prefixes (OpenAI, Anthropic, GitHub, AWS, Slack, Telegram bot token)
  [
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    "[REDACTED_TOKEN]",
  ],
  // URLs with embedded credentials (postgres://user:pass@host, https://user:pass@host)
  [
    /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi,
    "$1[REDACTED]$2",
  ],
  // Env / config assignments like PASSWORD=..., API_KEY=..., SECRET_TOKEN=...
  [
    /(\b[A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|AUTH_TOKEN|BOT_TOKEN|CLIENT_SECRET)\s*[:=]\s*["']?)([^\s'"`,;]{4,})(["']?)/gi,
    "$1[REDACTED]$3",
  ],
];

export function maskCommandOutput(
  raw: string | null | undefined,
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (!raw) return "";
  let masked = raw;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  if (masked.length > maxChars) {
    return `${masked.slice(0, maxChars)}\n… [truncated ${masked.length - maxChars} chars]`;
  }
  return masked;
}
