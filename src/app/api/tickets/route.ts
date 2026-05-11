import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { addTicketComment, createTicket, listTickets, updateTicketStatus } from "@/lib/ticket/service";
export const dynamic = "force-dynamic";
export async function GET(){ const session=await requireSession(); if(!sessionHasPermission(session,"ticket:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); return NextResponse.json({ tickets: await listTickets(session.userId) }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"ticket:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); if(body.ticketId) return NextResponse.json({ comment: await addTicketComment({ ticketId: body.ticketId, authorId: session.userId, body: body.body }) }, { status: 201 }); return NextResponse.json({ ticket: await createTicket({ title: body.title, description: body.description, priority: body.priority, createdBy: session.userId }) }, { status: 201 }); }
export async function PATCH(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"ticket:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); return NextResponse.json({ ticket: await updateTicketStatus({ id: body.id, status: body.status, assigneeId: body.assigneeId }) }); }
