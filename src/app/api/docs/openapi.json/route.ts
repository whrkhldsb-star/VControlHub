// Re-export OpenAPI JSON. Auth is enforced by the underlying handler
// (`withApiRoute(..., { requireAuth: true })` in ../openapi/route.ts).
// guardMode: delegated
export { GET } from "../openapi/route";
