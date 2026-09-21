import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({server:{findFirst:vi.fn()},rdpTicket:{findUnique:vi.fn(),deleteMany:vi.fn()}}));
vi.mock("@/lib/db",()=>({prisma:db}));
vi.mock("@/lib/auth/team-scope",()=>({serverTeamWhere:()=>({teamId:"team"})}));
import { consumeRdpTicket, hashRdpValue, rdpEndpointHash } from "@/lib/rdp/tickets";
import type { Server } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth/session";
const session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">={userId:"user",roles:["admin"],currentTeamId:"team"};
const token="a".repeat(43), origin="https://hub.example", cookie="session";
const server={id:"server",host:"8.8.8.8",port:3389,username:"Admin",operatingSystem:"WINDOWS",enabled:true,rdpPassword:"encrypted",teamId:"team"} as Server;
const ticket=()=>({hash:hashRdpValue(token),userId:"user",serverId:"server",teamId:"team",sessionHash:hashRdpValue(cookie),origin,endpointHash:rdpEndpointHash(server),expiresAt:new Date(Date.now()+30000)});
describe("RDP ticket security",()=>{
 beforeEach(()=>{vi.resetAllMocks();process.env.SSH_WS_ALLOWED_ORIGINS=origin;db.server.findFirst.mockResolvedValue(server);db.rdpTicket.findUnique.mockResolvedValue(ticket());db.rdpTicket.deleteMany.mockResolvedValue({count:1});});
 it("atomically claims once and rejects replay",async()=>{await expect(consumeRdpTicket(token,session,cookie,origin)).resolves.toBe(server);db.rdpTicket.deleteMany.mockResolvedValue({count:0});await expect(consumeRdpTicket(token,session,cookie,origin)).rejects.toMatchObject({status:403});});
 it.each([{userId:"other"},{teamId:"other"},{sessionHash:"other"},{origin:"https://evil.example"},{expiresAt:new Date(0)},{endpointHash:"stale"}])("rejects invalid binding %j",async bad=>{db.rdpTicket.findUnique.mockResolvedValue({...ticket(),...bad});await expect(consumeRdpTicket(token,session,cookie,origin)).rejects.toMatchObject({status:403});expect(db.rdpTicket.deleteMany).not.toHaveBeenCalled();});
 it("rejects out-of-team resource",async()=>{db.server.findFirst.mockResolvedValue(null);await expect(consumeRdpTicket(token,session,cookie,origin)).rejects.toMatchObject({status:404});});
 it("fails closed for missing or foreign origin",async()=>{await expect(consumeRdpTicket(token,session,cookie,"")).rejects.toMatchObject({status:403});});
});
