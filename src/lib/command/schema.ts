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
}).pipe(z.array(z.string().min(1)).min(1, "至少选择 1 台目标 VPS"));

export const createCommandSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(120, "标题最多 120 个字符"),
  command: z.string().trim().min(1, "命令不能为空").max(10_000, "命令内容过长"),
  reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
  submissionMode: z.enum(["user", "assistant"]),
  requesterId: z.string().trim().min(1, "请求人不能为空"),
  serverIds: normalizedServerIdsSchema,
});

export const reviewCommandSchema = z.object({
  commandRequestId: z.string().trim().min(1, "命令请求不能为空"),
  approverId: z.string().trim().min(1, "审批人不能为空"),
  approved: z.boolean(),
  comment: z.string().trim().max(500, "审批意见最多 500 个字符").optional(),
});

export type CreateCommandInput = z.infer<typeof createCommandSchema>;
export type ReviewCommandInput = z.infer<typeof reviewCommandSchema>;
