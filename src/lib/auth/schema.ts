import { z } from "zod";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters"),
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
