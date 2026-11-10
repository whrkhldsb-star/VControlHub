import { z } from "zod";

const normalizedServerIdsSchema = z.array(z.string()).transform((serverIds) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawServerId of serverIds) {
    const serverId = rawServerId.trim();
    if (!serverId || seen.has(serverId)) continue;
    seen.add(serverId);
    normalized.push(serverId);
  }

  return normalized;
}).pipe(z.array(z.string().min(1)).min(1, "At least 1 target VPS must be selected"));

/** The longest title a command request takes. */
export const COMMAND_TITLE_MAX_LENGTH = 120;

/**
 * The title of a request filed on someone's behalf: a label and a name they chose ("Scheduled task: <name>").
 * The name may be as long as a title itself, so the result is cut to fit. Over the limit the request was
 * refused, and the deployment, scheduled run or retry it stood for failed every time it was tried.
 */
export function commandRequestTitle(label: string, name: string): string {
  const title = `${label}${name}`.trim();
  if (title.length <= COMMAND_TITLE_MAX_LENGTH) return title;
  // Not half of a surrogate pair at the cut.
  return `${title.slice(0, COMMAND_TITLE_MAX_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

export const createCommandSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(COMMAND_TITLE_MAX_LENGTH, "Title must be at most 120 characters"),
  command: z.string().trim().min(1, "Command is required").max(10_000, "Command content is too long"),
  reason: z.string().trim().max(500, "Reason must be at most 500 characters").optional(),
  submissionMode: z.enum(["user", "assistant"]),
  approvalRequired: z.boolean().optional(),
  requesterId: z.string().trim().min(1, "Requester is required"),
  teamId: z.string().trim().min(1).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(300).optional(),
  serverIds: normalizedServerIdsSchema,
});

export const reviewCommandSchema = z.object({
  commandRequestId: z.string().trim().min(1, "Command request ID is required"),
  approverId: z.string().trim().min(1, "Approver is required"),
  approved: z.boolean(),
  comment: z.string().trim().max(500, "Approval comment must be at most 500 characters").optional(),
});

const commandTemplateNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(120, "Name must be at most 120 characters");
const commandTemplateCommandSchema = z
  .string()
  .trim()
  .min(1, "Command is required")
  .max(10_000, "Command content is too long");
const commandTemplateRollbackSchema = z
  .string()
  .trim()
  .max(10_000, "Rollback command is too long")
  .optional()
  .nullable();
const commandTemplateDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Description must be at most 500 characters")
  .optional();
const commandTemplateStringListSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .optional();

export const createCommandTemplateSchema = z.object({
  name: commandTemplateNameSchema,
  command: commandTemplateCommandSchema,
  rollbackCommand: commandTemplateRollbackSchema,
  description: commandTemplateDescriptionSchema,
  variables: commandTemplateStringListSchema,
  tags: commandTemplateStringListSchema,
});

export const updateCommandTemplateSchema = z.object({
  id: z.string().trim().min(1),
  name: commandTemplateNameSchema.optional(),
  command: commandTemplateCommandSchema.optional(),
  rollbackCommand: commandTemplateRollbackSchema,
  description: commandTemplateDescriptionSchema,
  variables: commandTemplateStringListSchema,
  tags: commandTemplateStringListSchema,
});

export type CreateCommandInput = z.infer<typeof createCommandSchema>;
export type ReviewCommandInput = z.infer<typeof reviewCommandSchema>;
