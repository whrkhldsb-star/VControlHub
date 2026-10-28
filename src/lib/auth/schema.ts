import { z } from "zod";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    // Same range as account creation (src/lib/user/schema.ts): accounts created with 2 or 33–40
    // characters used to be impossible to log in to.
    .min(2, "Username must be at least 2 characters")
    .max(40, "Username must be at most 40 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(8, "Current password must be at least 8 characters")
      .max(128, "Current password must be at most 128 characters"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(128, "New password must be at most 128 characters"),
    confirmPassword: z
      .string()
      .min(8, "Confirm password must be at least 8 characters")
      .max(128, "Confirm password must be at most 128 characters"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "The new passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
