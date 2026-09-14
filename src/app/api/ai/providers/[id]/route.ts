import { apiCopy } from "@/lib/i18n/api-copy";
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
import { serializeProvider } from "@/lib/ai/service-serialize";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

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
    { permission: "ai:manage", errorStatus: 404, errorMessage: apiCopy("apiCopy.not.found.e3ebaa16") },
    async ({ session }) => {
      if (!session)
        throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
      const { id } = await params;
      const provider = await getProviderById(id, session.userId);
      return NextResponse.json({ provider: serializeProvider(provider) });
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
      errorMessage: apiCopy("apiCopy.failed.to.update.8eb4917b"),
      bodySchema: updateProviderSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
      const { id } = await params;

      const updateBody = {
        ...body,
        ...parseAvailableModels(body),
      };
      const provider = await updateProvider(id, session.userId, updateBody);
      if (!provider) throw new NotFoundError(apiCopy("apiCopy.provider.not.found.90c36c40"));
      await auditUserAction(session.userId, "ai.provider.update", { providerId: id }, undefined, session?.currentTeamId);
      return NextResponse.json({ provider: serializeProvider(provider) });
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
      errorMessage: apiCopy("apiCopy.failed.to.delete.f625b14e"),
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
      const { id } = await params;
      await deleteProvider(id, session.userId);
      await auditUserAction(session?.userId ?? "", "ai.provider.delete", { providerId: id }, undefined, session?.currentTeamId);
      return NextResponse.json({ ok: true });
    },
  );
}
