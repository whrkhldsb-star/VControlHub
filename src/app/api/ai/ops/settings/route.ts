/**
 * TR-032 E02: /api/ai/ops/settings — read/write the current AI ops mode + provider.
 *
 * GET  → { mode, providerId, scanScheduleHour }
 *   Permission: ai:ops:read
 *
 * PATCH { mode?: "recommendation"|"autonomous", providerId?: string|null }
 *   → updated settings
 *   Permission: ai:ops:manage
 *
 * The actual storage is the standard `setting` table (string values); the
 * default values live in `lib/settings/service.ts#DEFAULTS` and the
 * whitelist is `lib/settings/schema.ts#VALID_SETTING_KEYS`. Both
 * `ai.ops.mode` and `ai.ops.provider` were added in Tick 3 — see the
 * `SettingKey` zod union and the `DEFAULTS` map for the schema-side
 * definitions.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AI_OPS_DEFAULT_SCHEDULE_HOUR } from "@/lib/ai/ops/types";
import { aiOpsModeSettingSchema } from "@/lib/ai/ops/schema";
import { getSetting, setSetting } from "@/lib/settings/service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

const VALID_PROVIDER_PATTERN = /^[A-Za-z0-9._:\-]{0,64}$/u;

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "加载 AI 运维设置失败",
		},
		async () => {
			const mode = await getSetting("ai.ops.mode");
			const providerId = await getSetting("ai.ops.provider");
			return NextResponse.json({
				mode: mode === "autonomous" ? "autonomous" : "recommendation",
				providerId: providerId.trim() ? providerId : null,
				scanScheduleHour: AI_OPS_DEFAULT_SCHEDULE_HOUR,
			});
		},
	);
}

export async function PATCH(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: aiOpsModeSettingSchema,
			errorStatus: 500,
			errorMessage: "保存 AI 运维设置失败",
		},
		async ({ session, body }) => {
			const previousMode = await getSetting("ai.ops.mode");
			const previousProvider = await getSetting("ai.ops.provider");

			// Provider is optional; if omitted, leave the stored value untouched.
			const providerChanged =
				body.providerId !== undefined && body.providerId !== previousProvider;
			if (
				body.providerId !== undefined &&
				!VALID_PROVIDER_PATTERN.test(body.providerId)
			) {
				return NextResponse.json(
					{
						error:
							"providerId 只能包含字母/数字/点/下划线/冒号/连字符, 最长 64 个字符",
					},
					{ status: 400 },
				);
			}

			await setSetting("ai.ops.mode", body.mode);
			if (body.providerId !== undefined) {
				await setSetting("ai.ops.provider", body.providerId);
			}

			// Normalize the response:
			//   - body.providerId === undefined  → keep the previously stored value (unchanged)
			//   - body.providerId === "" (or whitespace) → clear it, return null
			//   - otherwise                       → return the new value verbatim
			const nextProviderId =
				body.providerId === undefined
					? previousProvider.trim()
						? previousProvider
						: null
					: body.providerId.trim() !== ""
						? body.providerId
						: null;
			auditUserAction(
				session?.userId ?? "anonymous",
				"ai.ops.settings.update",
				{
					keys: ["ai.ops.mode", "ai.ops.provider"],
					mode: { from: previousMode, to: body.mode },
					providerId: providerChanged
						? { from: previousProvider, to: body.providerId ?? null }
						: null,
				},
			);

			return NextResponse.json({
				mode: body.mode,
				providerId: nextProviderId,
				scanScheduleHour: AI_OPS_DEFAULT_SCHEDULE_HOUR,
			});
		},
	);
}
