import { z } from "zod";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符"),
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(128, "密码最多 128 位"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(8, "当前密码至少 8 位")
      .max(128, "当前密码最多 128 位"),
    newPassword: z
      .string()
      .min(8, "新密码至少 8 位")
      .max(128, "新密码最多 128 位"),
    confirmPassword: z
      .string()
      .min(8, "确认密码至少 8 位")
      .max(128, "确认密码最多 128 位"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
