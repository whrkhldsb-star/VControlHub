import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteProvider,
  getProviderById,
  updateProvider,
} from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const updateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  models: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

function maskProvider(provider: Awaited<ReturnType<typeof getProviderById>>) {
  return {
    ...provider,
    apiKey: `${provider.apiKey.slice(0, 8)}...${provider.apiKey.slice(-4)}`,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function parseAvailableModels(data: z.infer<typeof updateProviderSchema>) {
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
    { requireAuth: true, errorStatus: 404, errorMessage: "未找到" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
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
      errorMessage: "更新失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateProviderSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
      }

      const updateBody = {
        ...parsed.data,
        ...parseAvailableModels(parsed.data),
      };
      const provider = await updateProvider(id, session.userId, updateBody);
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
      errorMessage: "删除失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { id } = await params;
      await deleteProvider(id, session.userId);
      return NextResponse.json({ ok: true });
    },
  );
}
