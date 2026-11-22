// Nonstandard DAV verbs enter the route as a POST with X-HTTP-Method-Override.
export const davPermissions: Record<string, string[][]> = {
  OPTIONS: [], GET: [["storage:read"]], HEAD: [["storage:read"]], PROPFIND: [["storage:read"]],
  PUT: [["storage:write"]], DELETE: [["storage:delete"]], MKCOL: [["storage:write"]],
  MOVE: [["storage:write"]], COPY: [["storage:read"], ["storage:write"]], PROPPATCH: [["storage:write"]],
};
