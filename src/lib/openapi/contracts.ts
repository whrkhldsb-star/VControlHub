/** Explicit machine contracts; other routes remain labelled as an index. */
const json = (schema: unknown) => ({ "application/json": { schema } });
const error = { type: "object", required: ["error"], properties: { error: { type: "string" } } };
const errors = Object.fromEntries([400, 401, 403, 429].map((status) => [String(status), {
  description: String(status), content: json(error),
  ...(status === 429 ? { headers: { "Retry-After": { schema: { type: "string" } } } } : {}),
}]));
export const machineContracts: Record<string, Record<string, Record<string, unknown>>> = {
  "/agent/v1/poll": {
    post: {
      security: [{ agentTokenAuth: [] }],
      requestBody: { required: true, content: json({
        type: "object",
        properties: {
          version: { type: "string", maxLength: 64 },
          capabilities: { type: "array", maxItems: 20, items: { type: "string", maxLength: 64 } },
          metricsRaw: { type: "string", maxLength: 64000 },
          error: { type: "string", nullable: true, maxLength: 1000 },
          heartbeatJobId: { type: "string", minLength: 1, maxLength: 128 },
          result: { type: "object", required: ["jobId", "exitCode"], properties: {
            jobId: { type: "string", minLength: 1, maxLength: 128 },
            stdout: { type: "string", maxLength: 8 * 1048576 },
            stderr: { type: "string", maxLength: 1048576 },
            exitCode: { type: "integer", minimum: -1, maximum: 255 },
          } },
        },
      }) },
      responses: { ...errors, "200": { description: "Agent poll", content: json({
        type: "object", required: ["pollAfterMs", "job"], properties: {
          pollAfterMs: { type: "integer", minimum: 0 }, cancelled: { type: "boolean" },
          job: { type: "object", nullable: true, required: ["id", "command", "timeoutMs"], properties: {
            id: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "integer" },
          } },
        },
      }) } },
    },
  },
  "/agent/v1/bootstrap": {
    get: {
      security: [{ agentTokenAuth: [] }],
      responses: { ...errors,
        "200": { description: "Windows agent installer", content: { "text/plain": { schema: { type: "string" } } } },
        "404": { description: "Not a Windows agent", content: json(error) },
        "503": { description: "Hub URL not configured", content: json(error) },
      },
    },
  },
  "/images/list": {
    get: {
      security: [{ cookieAuth: [] }, { apiTokenAuth: [] }],
      "x-vcontrolhub-token-scopes": ["image:read"],
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000000, default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 30 } },
        { name: "q", in: "query", schema: { type: "string", minLength: 1 } },
        { name: "album", in: "query", schema: { type: "string", minLength: 1 } },
        { name: "all", in: "query", description: "Cookie sessions with team/media management permission only; API tokens always list their own images.", schema: { type: "string", enum: ["true", "false"] } },
      ],
      responses: { ...errors, "200": { description: "Paginated images (additional image metadata may be present)", content: json({
        type: "object", required: ["images", "total", "page", "limit", "totalPages"], properties: {
          images: { type: "array", items: { type: "object", required: ["id", "filename", "publicUrl"], additionalProperties: true, properties: {
            id: { type: "string" }, filename: { type: "string" }, publicUrl: { type: "string" },
          } } },
          total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100 }, totalPages: { type: "integer", minimum: 1 },
        },
      }) } },
    },
  },
};
