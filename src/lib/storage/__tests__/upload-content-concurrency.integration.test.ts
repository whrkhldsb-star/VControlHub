// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
vi.hoisted(async () => { process.env.FILE_VERSION_DIR = await (await import("node:fs/promises")).mkdtemp((await import("node:path")).join((await import("node:os")).tmpdir(), "vch-fix-versions-")); });
const control=vi.hoisted(()=>({pause:false,entered:()=>{},wait:Promise.resolve()}));
vi.mock("@/lib/storage/file-content",async(importOriginal)=>{
 const real=await importOriginal<typeof import("@/lib/storage/file-content")>();
 return {...real,writeStorageFileFromLocalPath:async(...args:Parameters<typeof real.writeStorageFileFromLocalPath>)=>{if(control.pause){control.entered();await control.wait;}return real.writeStorageFileFromLocalPath(...args);}};
});
import {prisma} from "@/lib/db";
import {initMediaUploadSession,appendMediaUploadChunk,cleanupMediaUploadTempDir} from "@/lib/upload/service";
import {completeStorageFileUpload} from "../resumable-upload";
import {saveLocalEditableFileDraft,getLocalEditableFileDraft} from "../service-editable";
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("audit remediation integration", () => {
const id=`audit-r2-overwrite-${randomUUID()}`;let dir:string;const sessions:string[]=[];
const actor:SessionPayload={userId:id,username:id,roles:[],permissions:["storage:read","storage:write"],currentTeamId:id,mustChangePassword:false};
beforeAll(async()=>{
 const db=new URL(process.env.DATABASE_URL!);if(!["localhost","127.0.0.1","[::1]"].includes(db.hostname)||!/audit|test|_ci/.test(db.pathname))throw new Error("dedicated audit DB only");

 dir=await mkdtemp(join(tmpdir(),"vch-audit-r2-overwrite-"));
 await prisma.team.create({data:{id,name:id,slug:id}});await prisma.user.create({data:{id,username:id,passwordHash:"not-a-login"}});
 await prisma.storageNode.create({data:{id,name:id,teamId:id,driver:"LOCAL",basePath:dir}});
});
afterAll(async()=>{
 for(const session of sessions)await cleanupMediaUploadTempDir(session);
 await prisma.storageNode.deleteMany({where:{id}});await prisma.user.deleteMany({where:{id:{in:[id,`${id}-peer`]}}});await prisma.team.deleteMany({where:{id}});
 await rm(dir,{recursive:true,force:true});await rm(join(process.env.FILE_VERSION_DIR!,id),{recursive:true,force:true});await prisma.$disconnect();
});
async function upload(filename:string,content:string){
 const buffer=Buffer.from(content);const s=await initMediaUploadSession({userId:id,filename,mimeType:"text/plain",totalSize:buffer.length,chunkSize:131072,storageNodeId:id,relativePath:filename,session:actor});sessions.push(s.id);
 await appendMediaUploadChunk({sessionId:s.id,userId:id,index:0,size:buffer.length,buffer});return s;
}
it("refuses overwrite of recoverable recycle-bin content",async()=>{
 await writeFile(join(dir,"recycled.txt"),"original recycled bytes");
 const entry=await prisma.fileEntry.create({data:{storageNodeId:id,name:"recycled.txt",relativePath:"recycled.txt",entryType:"FILE",mimeType:"text/plain",size:BigInt(23),isDeleted:true,deleteBatchId:"deleted-batch"}});
 const s=await upload("recycled.txt","replacement bytes");
 await expect(completeStorageFileUpload({sessionId:s.id,session:actor})).rejects.toThrow();
 expect(await readFile(join(dir,"recycled.txt"),"utf8")).toBe("original recycled bytes");
 expect(await prisma.fileVersion.count({where:{fileEntryId:entry.id}})).toBe(0);
 expect(await prisma.fileEntry.findUniqueOrThrow({where:{id:entry.id}})).toMatchObject({isDeleted:true,deleteBatchId:"deleted-batch"});
});
it("serializes upload with editor and refuses a stale editor instead of losing an acknowledged save", async () => {
 await writeFile(join(dir,"race.txt"),"original before both");
 const entry=await prisma.fileEntry.create({data:{storageNodeId:id,name:"race.txt",relativePath:"race.txt",entryType:"FILE",mimeType:"text/plain",size:BigInt(20)}});
 const draft=await getLocalEditableFileDraft({fileEntryId:entry.id,session:actor});
 const s=await upload("race.txt","delayed upload wins");
 let release!:()=>void;control.wait=new Promise(r=>release=r);const entered=new Promise<void>(r=>control.entered=r);control.pause=true;
 const task=completeStorageFileUpload({sessionId:s.id,session:actor});
 await entered;
 let settled=false;
 const edit=saveLocalEditableFileDraft({fileEntryId:entry.id,session:actor,content:"editor bytes",expectedUpdatedAt:draft.updatedAt,expectedLastModifiedMs:draft.lastModifiedMs}).then(()=>{settled=true;return "saved";},()=>{settled=true;return "conflict";});
 try { await new Promise(r=>setTimeout(r,120)); expect(settled).toBe(false); }
 finally { release();control.pause=false; }
 expect((await task).session.status).toBe("COMPLETED");
 expect(await edit).toBe("conflict");
 const versions=await prisma.fileVersion.findMany({where:{fileEntryId:entry.id}});
 const bodies=await Promise.all(versions.map(v=>readFile(join(process.env.FILE_VERSION_DIR!,v.blobRelativePath),"utf8")));
 expect(bodies).toContain("original before both");
 expect(await readFile(join(dir,"race.txt"),"utf8")).toBe("delayed upload wins");
});
it("serializes complete uploads across different grants sharing the same directory",async()=>{
 const peer={...actor,userId:`${id}-peer`,username:`${id}-peer`};
 await prisma.user.create({data:{id:peer.userId,username:peer.username,passwordHash:"not-a-login"}});
 await prisma.userStorageAccess.createMany({data:[actor,peer].map(a=>({userId:a.userId,storageNodeId:id,pathPrefix:"quota",canRead:true,canWrite:true,quotaBytes:BigInt(100)}))});
 const views=[];
 for(const [index,a] of [actor,peer].entries()){
  const content=Buffer.alloc(80,65+index);
  const s=await initMediaUploadSession({userId:a.userId,filename:`file${index}.bin`,mimeType:"application/octet-stream",totalSize:content.length,chunkSize:131072,storageNodeId:id,relativePath:`quota/file${index}.bin`,session:a});sessions.push(s.id);
  await appendMediaUploadChunk({sessionId:s.id,userId:a.userId,index:0,size:content.length,buffer:content});views.push({s,a});
 }
 let release!:()=>void;control.wait=new Promise(r=>release=r);let reached=0;const first=new Promise<void>(r=>control.entered=()=>{reached++;r();});control.pause=true;
 const tasks=views.map(({s,a})=>completeStorageFileUpload({sessionId:s.id,session:a}));
 const resultsTask=Promise.allSettled(tasks);
 try { await first; await new Promise(r=>setTimeout(r,120)); expect(reached).toBe(1); }
 finally { control.pause=false;release(); }
 const results=await resultsTask;expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 const used=await prisma.fileEntry.aggregate({where:{storageNodeId:id,isDeleted:false,relativePath:{startsWith:"quota/"}},_sum:{size:true}});
 expect(used._sum.size).toBe(BigInt(80));
});


});
