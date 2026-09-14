import { z } from "zod";

export const FILE_OPERATION_JOB_TYPE = "storage.file-operation";
export class FileOperationUncertainError extends Error {}
export const fileOperationSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["copy", "move", "delete"]),
  fileEntryIds: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(1000)
    .transform((ids) => [...new Set(ids)]),
  targetDir: z.string().max(512).default("."),
  policy: z.enum(["skip", "rename", "overwrite"]).default("rename"),
});
export type FileOperationInput = z.infer<typeof fileOperationSchema>;
export type FileOperationResult = {
  id: string;
  name?: string;
  state: "running" | "success" | "skipped" | "error";
  error?: string;
  path?: string;
};
