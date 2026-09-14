import { apiCopy } from "@/lib/i18n/api-copy";
import { NextRequest, NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError } from "@/lib/errors";
import { listFilesQuerySchema } from "@/lib/files/schema";
import { getFilesListing } from "@/lib/files/listing-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withApiRoute(request,
    { permission:"storage:read",errorMessage:apiCopy("apiCopy.failed.to.fetch.file.list.b112fe9b") },
    async ({session}) => {
      if (!session) throw new AuthError(apiCopy("apiCopy.unauthorized.d089c8a9"));
      const query = parseSearchParams(request,listFilesQuerySchema);
      const {listing} = await getFilesListing(session,query);
      return NextResponse.json(listing);
    },
  );
}
