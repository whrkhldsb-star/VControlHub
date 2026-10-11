import { z } from "zod";

/* ── POST /api/users ─────────────────────────────────────────────────── */

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Username must be at least 2 characters")
    .max(40, "Username must be at most 40 characters")
    .regex(/^[A-Za-z0-9_.-]+$/, "Username can only contain letters, numbers, underscores, dots, and hyphens"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128, "Password must be at most 128 characters"),
  displayName: z.string().trim().max(80, "Display name must be at most 80 characters").optional(),
  /** A platform administrator, or a customer account with its identity template. */
  account: z.discriminatedUnion("type", [
    z.object({ type: z.literal("admin") }),
    z.object({ type: z.literal("customer"), teamId: z.string().trim().min(1), identityTemplateId: z.string().trim().min(1).nullable().optional() }),
  ]),
});

/* ── PATCH /api/users ────────────────────────────────────────────────── */

export const USER_PATCH_ACTIONS = ["disable", "enable", "reset_password"] as const;

export const updateUserSchema = z
  .object({
    userId: z.string().trim().min(1, "Missing user ID"),
    action: z.enum(USER_PATCH_ACTIONS, { message: "Unsupported action" }).optional(),
    newPassword: z
      .string()
      .min(6, "New password must be at least 6 characters")
      .max(128, "New password must be at most 128 characters")
      .optional(),
  })
  .refine(
    (data) =>
      data.action !== undefined ||
      data.newPassword !== undefined,
    { message: "At least one update field must be provided", path: [] },
  )
  // reset_password 必须带 newPassword
  .refine(
    (data) => data.action !== "reset_password" || Boolean(data.newPassword),
    { message: "reset_password must provide newPassword", path: ["newPassword"] },
  );
