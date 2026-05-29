import { z } from "zod";

const serverTagSchema = z
  .string()
  .trim()
  .min(1, "标签不能为空")
  .max(32, "标签最多 32 个字符");

export const createServerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "节点名称至少 2 个字符")
      .max(64, "节点名称最多 64 个字符"),
    host: z
      .string()
      .trim()
      .min(2, "IP 地址或主机名不能为空")
      .max(255, "IP 地址或主机名过长"),
    port: z.coerce
      .number()
      .int()
      .min(1, "端口最小为 1")
      .max(65535, "端口最大为 65535")
      .default(22),
    username: z
      .string()
      .trim()
      .max(64, "SSH 用户名过长")
      .optional()
      .default("root"),
    connectionType: z.enum(["SSH_KEY", "PASSWORD"]).default("SSH_KEY"),
    sshKeyId: z.string().trim().optional(),
    password: z.string().trim().optional(),
    description: z
      .string()
      .trim()
      .max(255, "描述最多 255 个字符")
      .optional()
      .transform((value) => value || undefined),
    tags: z.array(serverTagSchema).max(20, "标签最多 20 个").default([]),
    enableDirectGateway: z.boolean().optional().default(false),
    storagePath: z
      .string()
      .trim()
      .min(1, "存储路径不能为空")
      .max(500, "路径过长")
      .default("/root/drive"),
  })
  .refine(
    (data) => {
      if (data.connectionType === "SSH_KEY" && !data.sshKeyId) return false;
      if (data.connectionType === "PASSWORD" && !data.password) return false;
      return true;
    },
    { message: "SSH 密钥连接方式需选择密钥，密码连接方式需填写密码" },
  );

export type CreateServerInput = z.input<typeof createServerSchema>;
