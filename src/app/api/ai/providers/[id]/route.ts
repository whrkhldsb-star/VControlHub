import { NextResponse } from "next/server";

import {
  deleteProvider,
  getProviderById,
  updateProvider,
} from "@/lib/ai/service";
import {
  type UpdateProviderInputWire,
  updateProviderSchema,
} from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

function maskProvider(provider: Awaited<ReturnType<typeof getProviderById>>) {
  return {
    ...provider,
    apiKey: `${provider.apiKey.slice(0, 8)}...${provider.apiKey.slice(-4)}`,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function parseAvailableModels(data: UpdateProviderInputWire) {
  if (data.availableModels !== undefined) {
    return {
      availableModels: Array.from(
        new Set(data.availableModels.map((model) => model.trim()).filter(Boolean)),
      ),
    };
  }
  if (data.models !== undefined) {
    return {
      availableModels: Array.from(
        new Set(
          data.models
            .split(",")
            .map((model) => model.trim())
            .filter(Boolean),
        ),
      ),
    };
  }
  return {};
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "ai:manage", errorStatus: 404, errorMessage: "Not found" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const { id } = await params;
      const provider = await getProviderById(id, session.userId);
      return NextResponse.json({ provider: maskProvider(provider) });
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ai:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "UpdateFailed",
      bodySchema: updateProviderSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const { id } = await params;

      const updateBody = {
        ...body,
        ...parseAvailableModels(body),
      };
      const provider = await updateProvider(id, session.userId, updateBody);
      if (!provider) throw new NotFoundError("Provider not found");
      await auditUserAction(session.userId, "ai.provider.update", { providerId: id });
      return NextResponse.json({ provider: maskProvider(provider) });
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ai:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "DeleteFailed",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const { id } = await params;
      await deleteProvider(id, session.userId);
      await auditUserAction(session?.userId ?? "", "ai.provider.delete", { providerId: id });
      return NextResponse.json({ ok: true });
    },
  );
}
