/**
 * Aria2 JSON-RPC HTTP adapter.
 *
 * Centralises the `fetch` + JSON-RPC envelope + error mapping for the
 * outbound aria2 RPC calls (addUri / tellStatus / getVersion / etc).
 * The service layer decides *what* to send (method name, params, secret);
 * this adapter decides *how* to send it (HTTP method, JSON encoding,
 * id generation, ok/!ok branching, RPC error vs HTTP error formatting).
 *
 * Why the error mapping lives here: callers should not need to know whether
 * a failure is a 502 (transport down) or a JSON-RPC `error: { code, message }`
 * body — the adapter formats the human-readable string in both cases.
 */

const RPC_HTTP_ERROR_BODY_MAX = 500;

export type Aria2RpcRequest = {
  url: string;
  method: string;
  params: unknown[];
  secret: string;
};

export type Aria2RpcErrorBody = {
  code?: number;
  message?: string;
};

export type Aria2RpcResponseBody = {
  result?: unknown;
  error?: Aria2RpcErrorBody;
};

function newRpcId(): string {
  return Date.now().toString();
}

export async function postAria2Rpc(req: Aria2RpcRequest): Promise<unknown> {
  const response = await fetch(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: newRpcId(),
      method: req.method,
      params: [`token:${req.secret}`, ...req.params],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(aria2HttpErrorMessage(response.status, errorText));
  }

  const data = (await response.json().catch(() => ({}))) as Aria2RpcResponseBody;
  if (data.error) {
    throw new Error(aria2RpcErrorMessage(data.error));
  }
  return data.result;
}

export function aria2HttpErrorMessage(status: number, errorText: string): string {
  const trimmed = (errorText || "").trim();
  const body = trimmed.length > 0 ? trimmed.slice(0, RPC_HTTP_ERROR_BODY_MAX) : "Unknown error";
  return `Aria2 RPC 请求失败 (${status}): ${body}`;
}

export function aria2RpcErrorMessage(error: Aria2RpcErrorBody): string {
  if (error.message && error.message.length > 0) {
    return `Aria2 RPC error: ${error.message}`;
  }
  return `Aria2 RPC error: ${JSON.stringify(error)}`;
}
