/**
 * Deployment DTO boundary (TR-039).
 *
 * The `service.ts` module owns the deployment-run / snapshot / rollback
 * lifecycle: it imports Prisma, the command-approval pipeline and the
 * command-template renderer. None of that should reach a client
 * component, but the `/deployments` page (server-rendered) and the
 * launch / rollback panels (client islands) need the wire shapes that
 * come out of `listDeploymentTemplates` and `listDeploymentRuns`.
 *
 * The status / error-resolution logic in `service.ts` rewrites the
 * prisma `Date` fields and may add a `resolved` status that differs
 * from the persisted `status`. The DTOs declared here match the shape
 * the deployment page actually consumes after the resolution pass.
 *
 * `service.ts` re-exports every type declared here so existing call
 * sites `from "@/lib/deployment/service"` keep working unchanged. New
 * client / API code should import the wire DTO types from this module.
 *
 * Pure types only — no runtime side effects, no Prisma, no DB.
 */

/**
 * Deployment status values that the UI is allowed to render. The service
 * resolver can project a persisted `PENDING` / `APPROVED` into a more
 * user-friendly form (e.g. `RUNNING`) based on the linked command
 * request; the list DTOs report the resolved value.
 */
export type DeploymentStatusDto =
  | "PENDING"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED";

/**
 * Slim deployment template — what `listDeploymentTemplates` returns and
 * what the launch form needs. The template's `command` and
 * `rollbackCommand` carry `{{variable}}` placeholders that the
 * server-side renderer expands, so the client only needs the metadata
 * for display and form defaults.
 */
export type DeploymentTemplateDto = {
  id: string;
  name: string;
  description?: string | null;
  command: string;
  rollbackCommand?: string | null;
  variables: string[];
  category?: string | null;
  isBuiltin: boolean;
  isActive: boolean;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

/**
 * Deployment snapshot — the immutable record captured at
 * `createDeploymentRunFromTemplate` time. Used by the rollback form to
 * show the command that would be re-executed.
 */
export type DeploymentSnapshotDto = {
  id: string;
  sourceRunId: string;
  templateId: string;
  templateName: string;
  deployCommand: string;
  rollbackCommand: string | null;
  variables: Record<string, string>;
  serverIds: string[];
  createdBy: string;
  createdAt: string | Date;
};

/**
 * Rollback run — the per-rollback execution record. The status mirrors
 * the underlying `DeploymentRollbackRun` row but is rewritten by the
 * service resolver to reflect the linked command-request outcome.
 */
export type DeploymentRollbackRunDto = {
  id: string;
  sourceRunId: string;
  snapshotId: string;
  rollbackCommand: string;
  serverIds: string[];
  reason: string;
  status: DeploymentStatusDto;
  errorMessage: string | null;
  commandRequest?: { status: string } | null;
  snapshot?: DeploymentSnapshotDto | null;
  createdBy: string;
  createdAt: string | Date;
  completedAt?: string | Date | null;
};

/**
 * Full deployment run as the deployments page sees it — output of
 * `listDeploymentRuns` after `persistResolvedDeploymentRunStatus`.
 * The `template`, `creator`, `commandRequest` and `rollbackAttempts`
 * sub-shapes are the ones the page / buttons actually use.
 */
export type DeploymentRunDto = {
  id: string;
  templateId: string;
  template: {
    id: string;
    name: string;
    command: string;
    rollbackCommand: string | null;
  };
  variables: Record<string, string> | null;
  renderedCommand: string;
  serverIds: string[];
  status: DeploymentStatusDto;
  errorMessage: string | null;
  snapshotId: string | null;
  snapshot: DeploymentSnapshotDto | null;
  commandRequestId: string | null;
  commandRequest: { status: string } | null;
  creator?: { username: string; displayName: string | null } | null;
  rollbackAttempts: DeploymentRollbackRunDto[];
  createdBy: string;
  createdAt: string | Date;
  completedAt?: string | Date | null;
};

/**
 * Input shape for `createDeploymentRunFromTemplate`. Exposed here so
 * the launch form (server action) and the route layer can reach for a
 * shared, pure-data type without importing the service module.
 */
export type DeploymentLaunchInputDto = {
  templateId: string;
  serverIds: string[];
  variables: Record<string, string>;
  requesterId: string;
  reason?: string;
};

/**
 * Input shape for `createDeploymentRollbackRun`. Same rationale as
 * `DeploymentLaunchInputDto`.
 */
export type DeploymentRollbackInputDto = {
  sourceRunId: string;
  requesterId: string;
  reason?: string;
};
