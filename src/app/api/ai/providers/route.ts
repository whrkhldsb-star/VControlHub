import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createProvider,
  listProviders,
  serializeProvider,
} from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const createProviderSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  models: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  isDefault: z.boolean().optional(),
});

function parseModels(data: { availableModels?: string[]; models?: string }) {
  const rawModels = data.availableModels ?? data.models?.split(",") ?? [];
  return Array.from(
    new Set(rawModels.map((model) => model.trim()).filter(Boolean)),
  );
}

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    if (!session)
      throw new AuthError("未认证");
    const providers = await listProviders(session.userId);
    return NextResponse.json({ providers: providers.map(serializeProvider) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");

      const body = await request.json().catch(() => null);
      const parsed = createProviderSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError("输入参数无效");
      }

      const provider = await createProvider({
        ...parsed.data,
        availableModels: parseModels(parsed.data),
        createdBy: session.userId,
      });
      return NextResponse.json(
        { provider: serializeProvider(provider) },
        { status: 201 },
      );
    },
  );
}
