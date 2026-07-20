import { z } from "zod";

const serverTagSchema = z
  .string()
  .trim()
  .min(1, "Tag is required")
  .max(32, "Tags must be at most 32 characters");

export const createServerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Node name must be at least 2 characters")
      .max(64, "Node name must be at most 64 characters"),
    host: z
      .string()
      .trim()
      .min(2, "IP address or hostname is required")
      .max(255, "IP address or hostname is too long"),
    port: z.coerce
      .number()
      .int()
      .min(1, "Port must be at least 1")
      .max(65535, "Port must be at most 65535")
      .default(22),
    username: z
      .string()
      .trim()
      .max(64, "SSH username is too long")
      .optional()
      .default("root"),
    connectionType: z.enum(["SSH_KEY", "PASSWORD"]).default("SSH_KEY"),
    sshKeyId: z.string().trim().optional(),
    password: z.string().trim().optional(),
    hostKeySha256: z.string().trim().max(128, "SSH host key fingerprint is too long").optional().or(z.literal("")),
    approvedHostKeySha256: z.string().trim().max(128, "SSH approved host key fingerprint is too long").optional().or(z.literal("")),
    description: z
      .string()
      .trim()
      .max(255, "Description must be at most 255 characters")
      .optional()
      .transform((value) => value || undefined),
    tags: z.array(serverTagSchema).max(20, "At most 20 tags are allowed").default([]),
    enableDirectGateway: z.boolean().optional().default(false),
    directGatewayProtocol: z.enum(["http", "https"]).optional().default("http"),
    directGatewayDomain: z.string().trim().max(253).optional(),
    storagePath: z
      .string()
      .trim()
      .min(1, "Storage path is required")
      .max(500, "Path is too long")
      .default("/root/drive"),
    costAutoSync: z.boolean().optional().default(false),
    costMonthlyAmount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/u, "Monthly fee must be a number with at most 2 decimal places")
      .optional()
      .or(z.literal(""))
      .transform((value) => value || undefined),
    costCurrency: z.enum(["CNY", "USD", "EUR", "JPY", "HKD"]).optional().default("CNY"),
    costProvider: z.string().trim().max(128, "Cost provider must be at most 128 characters").optional().transform((value) => value || undefined),
  })
  .refine(
    (data) => {
      if (data.connectionType === "SSH_KEY" && !data.sshKeyId) return false;
      if (data.connectionType === "PASSWORD" && !data.password) return false;
      return true;
    },
    { message: "SSH key connection requires selecting a key; password connection requires entering a password" },
  );

export type CreateServerInput = z.input<typeof createServerSchema>;
