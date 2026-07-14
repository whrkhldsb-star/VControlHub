import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  createBackupSchedule,
  listBackupSchedules,
  toggleBackupSchedule,
  updateBackupSchedule,
} from "@/lib/backup/schedule-service";
import { createBackupScheduleSchema, patchBackupScheduleSchema } from "@/lib/backup/schedule-schema";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async ({ session }) => {
    return NextResponse.json({ schedules: await listBackupSchedules(200, session!) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to create backup schedule",
      bodySchema: createBackupScheduleSchema,
    },
    async ({ session, body }) => {
      // The bodySchema enforces shape; createBackupSchedule re-validates
      // cron + backupType + retention at the service layer for defense in
      // depth (service is also callable from the worker/tests).
      const schedule = await createBackupSchedule({
        ...body,
        createdById: session?.userId,
        teamId: session?.currentTeamId ?? null,
      });
      await auditUserAction(session?.userId ?? "", "backup-schedule.create", { scheduleId: schedule.id });
      return NextResponse.json({ schedule }, { status: 201 });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to update backup schedule",
      bodySchema: patchBackupScheduleSchema,
    },
    async ({ session, body }) => {
      if ("toggleId" in body) {
        const result = await toggleBackupSchedule(body.toggleId, session!);
        return NextResponse.json({ schedule: result });
      }
      const { id, ...updates } = body;
      const result = await updateBackupSchedule(id, updates, session!);
      return NextResponse.json({ schedule: result });
    },
  );
}
