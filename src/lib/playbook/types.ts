/**
 * TR-023 M04: Playbook types — trigger / step / chain shapes.
 *
 * Stored as JSON inside the Playbook model. The shape is closed at the zod
 * boundary (`schema.ts`) so callers and tests can rely on the union of
 * trigger types and step kinds.
 */

export const TRIGGER_TYPES = ["cron", "metric"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const METRICS = ["cpu_usage", "mem_usage", "disk_usage"] as const;
export type MetricName = (typeof METRICS)[number];

export const OPERATORS = ["gt", "gte", "lt", "lte", "eq"] as const;
export type Operator = (typeof OPERATORS)[number];

export type CronTriggerConfig = {
  expression: string; // 5-field cron
};

export type MetricTriggerConfig = {
  metric: MetricName;
  operator: Operator;
  threshold: number;
};

export type TriggerConfig = CronTriggerConfig | MetricTriggerConfig;

/**
 * Step kinds shipped in M04. Each kind has its own `config` shape; the
 * discriminated union lets the executor pattern-match without an `any`.
 */
export const STEP_TYPES = ["run_command", "send_notification", "call_webhook"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export type RunCommandStepConfig = {
  command: string;
  serverIds: string[]; // empty = no-op
  // Variables are interpolated as {{var}} into the command.
  variables?: Record<string, string>;
};

export type SendNotificationStepConfig = {
  // User id of the recipient. The notification kind defaults to "playbook"
  // and the executor fills in the playbook + run context.
  recipientUserId: string;
  subject: string;
  body: string;
};

export type CallWebhookStepConfig = {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string; // JSON-encoded; executor will pass through
};

export type StepConfig =
  | RunCommandStepConfig
  | SendNotificationStepConfig
  | CallWebhookStepConfig;

export type PlaybookStepResult = {
  stepId: string;
  status: "ok" | "failed" | "skipped" | "dry_run";
  startedAt: string;
  completedAt: string;
  // Truncated summary of the step's output; raw output is NOT persisted
  // to keep `stepResults` bounded.
  summary: string;
  error?: string;
};

/**
 * Discriminated union for the stored `Playbook.steps` JSON. The union is
 * open at the API boundary (the editor builds the literal type) but the
 * zod schema in `schema.ts` enforces the same shape at runtime.
 */
export type PlaybookStep =
  | {
      id: string;
      name: string;
      type: "run_command";
      config: RunCommandStepConfig;
      retry: number;
      timeoutSec: number;
    }
  | {
      id: string;
      name: string;
      type: "send_notification";
      config: SendNotificationStepConfig;
      retry: number;
      timeoutSec: number;
    }
  | {
      id: string;
      name: string;
      type: "call_webhook";
      config: CallWebhookStepConfig;
      retry: number;
      timeoutSec: number;
    };

/**
 * The Playbook record as it lives in the database. The Prisma client
 * narrows `triggerType` and `steps` to JSON, so we re-export a stricter
 * shape that the executor and tests can use directly.
 */
export type PlaybookRecord = {
  id: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  steps: PlaybookStep[];
  chainRetry: number;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlaybookRunRecord = {
  id: string;
  playbookId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  dryRun: boolean;
  triggerContext: unknown;
  stepResults: PlaybookStepResult[];
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};
