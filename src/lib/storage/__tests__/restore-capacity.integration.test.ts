// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
const state=vi.hoisted(()=>({session:null as SessionPayload|null}));
vi.mock("@/lib/auth/authorization",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/auth/authorization")>(),requirePermission:async()=>state.session!}));
vi.mock("@/lib/i18n/server-locale",()=>({serverT:async()=>((key:string)=>key)}));
import { prisma } from "@/lib/db";
import { assertStorageAccess, releaseStorageQuotaGuard, getStorageAccessUsage } from "../access-control";
import { restoreFileEntryAction } from "@/app/storage/actions-file-entries";
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("audit remediation integration", () => {
const id=`audit-r2-quota-${randomUUID()}`;
let dir:string;
const actor=(u:string):SessionPayload=>({userId:u,username:u,roles:[],permissions:["storage:read","storage:write","storage:delete"],currentTeamId:id,mustChangePassword:false});
beforeAll(async()=>{
 const db=new URL(process.env.DATABASE_URL!);if(!["localhost","127.0.0.1","[::1]"].includes(db.hostname)||!/audit|test|_ci/.test(db.pathname))throw new Error("dedicated audit DB only");
 dir=await mkdtemp(join(tmpdir(),"vch-audit-r2-quota-"));
 await prisma.team.create({data:{id,name:id,slug:id}});
 await prisma.user.createMany({data:[id,`${id}-peer`].map(id=>({id,username:id,passwordHash:"not-a-login"}))});
 await prisma.storageNode.create({data:{id,name:id,teamId:id,driver:"LOCAL",basePath:dir}});
 state.session=actor(id);
});
afterAll(async()=>{
 await prisma.auditLog.deleteMany({where:{actorId:{in:[id,`${id}-peer`]}}});
 await prisma.storageNode.deleteMany({where:{id}});
 await prisma.user.deleteMany({where:{id:{in:[id,`${id}-peer`]}}});
 await prisma.team.deleteMany({where:{id}});await rm(dir,{recursive:true,force:true});await prisma.$disconnect();
});
it("recycle restore refuses bytes above current quota and file-size cap",async()=>{
 await writeFile(join(dir,"deleted.txt"),"x".repeat(80));
 const entry=await prisma.fileEntry.create({data:{storageNodeId:id,name:"deleted.txt",relativePath:"deleted.txt",entryType:"FILE",size:BigInt(80),isDeleted:true}});
 await prisma.userStorageAccess.create({data:{userId:id,storageNodeId:id,pathPrefix:"",canRead:true,canWrite:true,canDelete:true,quotaBytes:BigInt(5),maxFileBytes:BigInt(5)}});
 const admission=await assertStorageAccess({session:actor(id),storageNodeId:id,relativePath:"deleted.txt",operation:"write",writeBytes:80});
 expect(admission.allowed).toBe(false);await releaseStorageQuotaGuard(admission);
 const form=new FormData();form.set("fileEntryId",entry.id);
 const result=await restoreFileEntryAction(null,form);
 expect(result).toHaveProperty("error");
 expect((await prisma.fileEntry.findUniqueOrThrow({where:{id:entry.id}})).isDeleted).toBe(true);
 expect(await getStorageAccessUsage({storageNodeId:id,pathPrefix:""})).toBe(BigInt(0));
});
it("applies quota alone and admits a restore once capacity is sufficient",async()=>{
 await prisma.userStorageAccess.updateMany({where:{userId:id},data:{maxFileBytes:null,quotaBytes:BigInt(5)}});
 const entry=await prisma.fileEntry.findFirstOrThrow({where:{storageNodeId:id,relativePath:"deleted.txt"}});
 const form=new FormData();form.set("fileEntryId",entry.id);
 expect(await restoreFileEntryAction(null,form)).toHaveProperty("error");
 await prisma.userStorageAccess.updateMany({where:{userId:id},data:{quotaBytes:BigInt(100)}});
 expect(await restoreFileEntryAction(null,form)).toHaveProperty("success");
 expect(await getStorageAccessUsage({storageNodeId:id,pathPrefix:""})).toBe(BigInt(80));
});
it("checks a deleted directory batch as a whole before reviving any child",async()=>{
 await mkdir(join(dir,"folder"));
 await writeFile(join(dir,"folder","a.txt"),"x".repeat(15));
 await writeFile(join(dir,"folder","b.txt"),"x".repeat(15));
 const root=await prisma.fileEntry.create({data:{storageNodeId:id,name:"folder",relativePath:"folder",entryType:"DIRECTORY",isDeleted:true,deleteBatchId:"folder-batch"}});
 await prisma.fileEntry.createMany({data:["a.txt","b.txt"].map(name=>({storageNodeId:id,name,relativePath:`folder/${name}`,entryType:"FILE",size:BigInt(15),isDeleted:true,deleteBatchId:"folder-batch"}))});
 const form=new FormData();form.set("fileEntryId",root.id);
 expect(await restoreFileEntryAction(null,form)).toHaveProperty("error");
 expect(await prisma.fileEntry.count({where:{storageNodeId:id,deleteBatchId:"folder-batch",isDeleted:true}})).toBe(3);
 await prisma.userStorageAccess.updateMany({where:{userId:id},data:{quotaBytes:BigInt(120)}});
 expect(await restoreFileEntryAction(null,form)).toHaveProperty("success");
 expect(await prisma.fileEntry.count({where:{storageNodeId:id,isDeleted:false}})).toBe(4);
 expect(await getStorageAccessUsage({storageNodeId:id,pathPrefix:""})).toBe(BigInt(110));
});
});
