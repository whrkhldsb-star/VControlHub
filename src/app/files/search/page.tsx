import { requireSession } from "@/lib/auth/require-session";
import { getStorageOverview } from "@/lib/storage/service";
import { FilesSearchClient } from "./files-search-client";

export const dynamic = "force-dynamic";

export default async function FilesSearchPage() {
  const session = await requireSession("/files/search");
  const storage = await getStorageOverview(session);

  return (
    <FilesSearchClient
      nodes={storage.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        driver: n.driver,
      }))}
    />
  );
}
