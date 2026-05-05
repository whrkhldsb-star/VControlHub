import { NextResponse } from "next/server";
import { getPublicStatus } from "@/lib/status/service";
export const dynamic = "force-dynamic";
export async function GET(){ return NextResponse.json(await getPublicStatus()); }
