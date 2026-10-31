import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/lib/db";
import { installDirectSession } from "./helpers/direct-session";
import { applyCustomerMembership } from "../src/lib/team/service";

test("audit remediation HTTP blocks metadata leaks, admits COPY, enforces MOVE quota and revokes transferred images", async ({ browser, baseURL }) => {
  test.skip(process.env.AUDIT_REMEDIATION_ISOLATED !== "1", "Requires the dedicated audit-remediation database and app");
  test.setTimeout(120000);
  const db = new URL(process.env.DATABASE_URL!);
  if (db.port !== "25435" || db.pathname !== "/vcontrolhub_fix_remaining_e2e" || baseURL !== "http://127.0.0.1:3493") throw new Error("Isolated audit targets required");
  const id = `boundary-${randomUUID()}`;
  const a = `${id}-a`, b = `${id}-b`, u = `${id}-u`, node = `${id}-n`, template = `${id}-t`, imageId = `${id}-image`;
  const root = path.join(process.cwd(), "storage", id);
  const imagePath = path.join(process.cwd(), "uploads", "image-bed", `${id}.png`);
  const context = await browser.newContext({ baseURL });
  try {
    await prisma.team.createMany({ data: [a,b].map(id => ({ id, name:id, slug:id })) });
    await prisma.identityTemplate.create({ data: { id:template, name:template, permissions:["storage:read","storage:write","storage:delete","image:read","image:write","api-token:manage"], isBuiltin:false } });
    await prisma.user.create({ data: { id:u, username:u, passwordHash:"fixture-not-used-for-login", status:"ACTIVE", mustChangePassword:false, currentTeamId:a } });
    await prisma.teamMember.create({ data: { userId:u, teamId:a, identityTemplateId:template } });
    await prisma.storageNode.create({ data: { id:node, teamId:a, name:node, driver:"LOCAL", basePath:root } });
    await mkdir(path.join(root,"secret"),{recursive:true});
    await writeFile(path.join(root,"secret","private.txt"),"fixture secret bytes");
    await writeFile(path.join(root,"original.bin"),"copy-fixture");
    await prisma.fileEntry.create({data:{storageNodeId:node,relativePath:"original.bin",name:"original.bin",entryType:"FILE",size:BigInt(12),mimeType:"application/octet-stream"}});
    await prisma.fileEntry.create({ data: { id:`${id}-entry`,storageNodeId:node,relativePath:"secret/private.txt",name:"private.txt",entryType:"FILE",size:BigInt(20),mimeType:"text/plain" } });
    await prisma.userStorageAccess.create({ data: { userId:u,storageNodeId:node,pathPrefix:"public",canRead:true,canWrite:true,canDelete:true } });
    await installDirectSession(context,{username:u});
    const csrf=(await context.cookies()).find(c=>c.name==="csrf_token")!.value;
    await context.setExtraHTTPHeaders({"x-csrf-token":csrf});
    const list=await context.request.get(`/api/files/list?nodeId=${node}&path=secret`);
    expect(list.status()).toBe(403);
    expect(await list.text()).not.toContain("private.txt");
    const content=await context.request.get(`/api/storage/local?nodeId=${node}&path=secret%2Fprivate.txt`);
    expect(content.status()).toBe(403);
    await prisma.userStorageAccess.deleteMany({where:{userId:u}});
    const issued=await context.request.post("/api/api-tokens",{data:{name:id,scopes:["storage:read","storage:write","storage:delete"]}});
    expect(issued.status()).toBe(201);
    const token=(await issued.json()).token;
    const copy=await context.request.fetch(`/api/webdav/${node}/original.bin`,{method:"COPY",headers:{Authorization:`Bearer ${token}`,Destination:`/api/webdav/${node}/copied.bin`}});
    const copyBody = await copy.text();
    // requireAccess throws BusinessError (default 422), not ForbiddenError.
    expect(copy.status(), copyBody).toBe(201);
    const copied = await context.request.get(`/api/webdav/${node}/copied.bin`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await copied.text()).toBe("copy-fixture");
    const overwrite = await context.request.fetch(`/api/webdav/${node}/original.bin`,{method:"COPY",headers:{Authorization:`Bearer ${token}`,Destination:`/api/webdav/${node}/copied.bin`,Overwrite:"T"}});
    expect(overwrite.status(), await overwrite.text()).toBe(204);
    await mkdir(path.join(root,"limited"), {recursive:true});
    await prisma.userStorageAccess.createMany({data:[
      {userId:u,storageNodeId:node,pathPrefix:"original.bin",canRead:true,canWrite:true,canDelete:true},
      {userId:u,storageNodeId:node,pathPrefix:"limited",canRead:true,canWrite:true,canDelete:true,quotaBytes:BigInt(5),maxFileBytes:BigInt(5)},
    ]});
    const moved=await context.request.fetch(`/api/webdav/${node}/original.bin`,{method:"MOVE",headers:{Authorization:`Bearer ${token}`,Destination:`/api/webdav/${node}/limited/moved.bin`}});
    expect(moved.status(), await moved.text()).toBe(422);
    expect(await prisma.fileEntry.findFirst({where:{storageNodeId:node,relativePath:"limited/moved.bin"}})).toBeNull();
    expect(await prisma.fileEntry.findFirst({where:{storageNodeId:node,relativePath:"original.bin"}})).not.toBeNull();
    await prisma.userStorageAccess.updateMany({where:{userId:u,pathPrefix:"limited"}, data:{quotaBytes:BigInt(100),maxFileBytes:BigInt(100)}});
    const acceptedMove=await context.request.fetch(`/api/webdav/${node}/original.bin`,{method:"MOVE",headers:{Authorization:`Bearer ${token}`,Destination:`/api/webdav/${node}/limited/moved.bin`}});
    expect(acceptedMove.status(), await acceptedMove.text()).toBe(201);
    await mkdir(path.dirname(imagePath),{recursive:true});
    await writeFile(imagePath,"private-image-fixture");
    await prisma.imageUpload.create({data:{id:imageId,userId:u,teamId:a,filename:"private.png",storageKey:`${id}.png`,mimeType:"image/png",sizeBytes:21,isPublic:false}});
    await prisma.$transaction(tx=>applyCustomerMembership(tx,{userId:u,teamId:b,identityTemplateId:template}));
    expect((await prisma.imageUpload.findUniqueOrThrow({where:{id:imageId}})).teamId).toBe(a);
    const images=await context.request.get("/api/images/list");
    expect(images.status()).toBe(200);
    expect((await images.json()).images.some((x:{id:string})=>x.id===imageId)).toBe(false);
    const oldImage=await context.request.get(`/api/images/${imageId}/file`);
    expect(oldImage.status()).toBe(404);
    const remove=await context.request.delete(`/api/images/${imageId}`);
    expect(remove.status()).toBe(403);
    expect(await prisma.imageUpload.findUnique({where:{id:imageId}})).not.toBeNull();
  } finally {
    await context.close();
    await prisma.imageUpload.deleteMany({where:{id:imageId}});
    await prisma.auditLog.deleteMany({where:{actorId:u}});
    await prisma.user.deleteMany({where:{id:u}});
    await prisma.storageNode.deleteMany({where:{id:node}});
    await prisma.team.deleteMany({where:{id:{in:[a,b]}}});
    await prisma.identityTemplate.deleteMany({where:{id:template}});
    await rm(root,{recursive:true,force:true});
    await rm(path.join(process.cwd(),"storage",".versions",node), {recursive:true,force:true});
    await rm(imagePath,{force:true});
    await prisma.$disconnect();
  }
});
