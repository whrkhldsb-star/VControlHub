import { ValidationError } from "@/lib/errors";

/** Resolve and normalize the playbook id route param (shared by /api/playbooks/[id]/*). */
export async function requirePlaybookId(
  params: Promise<{ id?: string }>,
): Promise<string> {
  const { id } = await params;
  const normalized = id?.trim();
  if (!normalized) throw new ValidationError("Missing playbook id");
  return normalized;
}
