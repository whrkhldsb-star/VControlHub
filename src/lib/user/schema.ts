import { z } from "zod";

/* ── POST /api/users ─────────────────────────────────────────────────── */

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Username must be at least 2 characters")
    .max(40, "Username must be at most 40 characters")
    .regex(/^[A-Za-z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点、横线"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128, "Password must be at most 128 characters"),
  displayName: z.string().trim().max(80, "Display name must be at most 80 characters").optional(),
  roleKeys: z.array(z.string()).max(20).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/* ── PATCH /api/users ────────────────────────────────────────────────── */

export const USER_PATCH_ACTIONS = ["disable", "enable", "reset_password"] as const;
export type UserPatchAction = (typeof USER_PATCH_ACTIONS)[number];

export const updateUserSchema = z
  .object({
    userId: z.string().trim().min(1, "Missing user ID"),
    action: z.enum(USER_PATCH_ACTIONS, { message: "不支持的 action" }).optional(),
    roleKeys: z.array(z.string()).max(20).optional(),
    newPassword: z
      .string()
      .min(6, "New password must be at least 6 characters")
      .max(128, "New password must be at most 128 characters")
      .optional(),
  })
  .refine(
    (data) =>
      data.action !== undefined ||
      data.roleKeys !== undefined ||
      data.newPassword !== undefined,
    { message: "至少提供一个更新字段", path: [] },
  )
  // reset_password 必须带 newPassword
  .refine(
    (data) => data.action !== "reset_password" || Boolean(data.newPassword),
    { message: "reset_password 必须提供 newPassword", path: ["newPassword"] },
  );
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
