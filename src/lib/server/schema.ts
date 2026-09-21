import { z } from "zod";
import { rdpProfileSchema } from "@/lib/rdp/protocol";

const serverTagSchema = z
  .string()
  .trim()
  .min(1, "Tag is required")
  .max(32, "Tags must be at most 32 characters");

const storagePathSchema = z
  .string()
  .trim()
  .min(1, "Storage path is required")
  .max(500, "Path is too long")
  .refine((value) => value.startsWith("/"), "Storage path must be an absolute POSIX path")
  .refine((value) => !value.includes("\0") && !value.split("/").includes(".."), "Storage path must not contain traversal segments")
  .refine((value) => !["/", "/proc", "/sys", "/dev"].includes(value.replace(/\/+$/, "") || "/"), "Storage path must not target a system root")
  .default("/root/drive");

const linuxServerSchema = z
  .object({
    operatingSystem: z.enum(["LINUX", "WINDOWS"]).default("LINUX"),
    name: z
      .string()
      .trim()
      .min(2, "Node name must be at least 2 characters")
      .max(64, "Node name must be at most 64 characters"),
    host: z
      .string()
      .trim()
      .min(2, "IP address or hostname is required")
      .max(255, "IP address or hostname is too long")
      // Must not be reinterpretable as an ssh CLI option (argv-injection guard).
      .refine((value) => !value.startsWith("-"), "Host must not begin with '-'")
      .refine((value) => /^[A-Za-z0-9._:\-\[\]]+$/.test(value), "Host contains invalid characters"),
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
      // Must not be reinterpretable as an ssh CLI option (argv-injection guard).
      .refine((value) => value === "" || !value.startsWith("-"), "Username must not begin with '-'")
      .refine((value) => value === "" || /^[A-Za-z0-9._@\-]+$/.test(value), "Username contains invalid characters")
      .optional()
      .default("root"),
    connectionType: z.enum(["SSH_KEY", "PASSWORD"]).default("SSH_KEY"),
    managementMode: z.enum(["DIRECT", "AGENT"]).default("DIRECT"),
    sshKeyId: z.string().trim().optional(),
    password: z.string().trim().optional(),
    hostKeySha256: z.string().trim().max(128, "SSH host key fingerprint is too long").optional().or(z.literal("")),
    approvedHostKeySha256: z.string().trim().max(128, "SSH approved host key fingerprint is too long").optional().or(z.literal("")),
    /** UI onboarding may persist an unreachable node as disabled configuration. */
    saveAsDraftOnConnectionFailure: z.boolean().optional().default(false),
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
    storagePath: storagePathSchema,
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
      if (data.operatingSystem === "WINDOWS") return true;
      if (data.connectionType === "SSH_KEY" && !data.sshKeyId) return false;
      if (data.connectionType === "PASSWORD" && !data.password) return false;
      return true;
    },
    { message: "SSH key connection requires selecting a key; password connection requires entering a password" },
  );

// Union keeps legacy Linux input compatible while giving Windows its own defaults.
export const createServerSchema = z.union([
  linuxServerSchema.safeExtend({ operatingSystem: z.literal("LINUX").default("LINUX") }),
  linuxServerSchema.safeExtend({
    host: rdpProfileSchema.shape.host,
    port: rdpProfileSchema.shape.port,
    username: rdpProfileSchema.shape.username,
    operatingSystem: z.literal("WINDOWS"),
    rdpPassword: rdpProfileSchema.shape.password,
    rdpDomain: rdpProfileSchema.shape.domain,
    rdpIgnoreCertificate: rdpProfileSchema.shape.ignoreCertificate,
    rdpCertificateSha256: rdpProfileSchema.shape.certificateSha256,
    managementMode: z.literal("DIRECT").default("DIRECT"),
    enableDirectGateway: z.literal(false).default(false),
    connectionType: z.literal("PASSWORD").default("PASSWORD"),
    sshKeyId: z.never().optional(),
    password: z.never().optional(),
  }).refine(data => !data.rdpCertificateSha256 || !data.rdpIgnoreCertificate, { message: "Certificate pinning cannot be combined with ignore certificate", path: ["rdpIgnoreCertificate"] }),
]);
export type CreateServerInput = z.input<typeof createServerSchema>;
