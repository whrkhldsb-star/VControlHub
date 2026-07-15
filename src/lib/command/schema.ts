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

export const createCommandSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  command: z.string().trim().min(1, "Command is required").max(10_000, "Command content is too long"),
  reason: z.string().trim().max(500, "Reason must be at most 500 characters").optional(),
  submissionMode: z.enum(["user", "assistant"]),
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

export const createCommandTemplateSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  rollbackCommand: z.string().optional().nullable(),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const updateCommandTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  rollbackCommand: z.string().optional().nullable(),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateCommandInput = z.infer<typeof createCommandSchema>;
export type ReviewCommandInput = z.infer<typeof reviewCommandSchema>;
export type CreateCommandTemplateInput = z.infer<typeof createCommandTemplateSchema>;
export type UpdateCommandTemplateInput = z.infer<typeof updateCommandTemplateSchema>;
