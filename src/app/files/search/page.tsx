import { requireSession } from "@/lib/auth/require-session";
import { listStorageNodes } from "@/lib/storage/service";
import { FilesSearchClient } from "./files-search-client";

export const dynamic = "force-dynamic";

export default async function FilesSearchPage() {
  const session = await requireSession("/files/search");
  const nodes = await listStorageNodes(session);

  return (
    <FilesSearchClient
      nodes={nodes.map((n) => ({
        id: n.id,
        name: n.name,
        driver: n.driver,
      }))}
    />
  );
}
