import { link } from "node:fs/promises";

import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** Publish complete bytes on the same filesystem. The caller still owns the source name. */
export async function publishLocalFile(source: string, destination: string, relativePath: string) {
  try {
    await link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ConflictError(t("backend.storage.pathAlreadyExists", { path: relativePath }));
    }
    throw error;
  }
}
