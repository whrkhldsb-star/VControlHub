// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => ({ exec: vi.fn(async (_input: {command:string}) => ({exitCode:1,stdout:"",stderr:"audit intentionally stopped before filesystem work"})) }));
vi.mock("@/lib/ssh/client", () => ({buildSshParamsFromServer: async () => ({host:"fixture.invalid",port:22,username:"fixture"}),execRemoteCommand:remote.exec}));
vi.mock("@/lib/ssh/sftp-service", () => ({downloadFile:vi.fn(() => {throw new Error("must not reach SFTP");})}));
import { prisma } from "@/lib/db";
import { oneFileAtATime } from "@/test/helpers/one-file-at-a-time";
import { runVpsBackupJobWorkerOnce } from "../vps-backup-job-worker";
import { dispatchDueVpsBackupSchedules } from "../vps-backup-schedule-service";
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("audit remediation integration", () => {
// Other files dispatch every due VPS backup schedule too: not while this one parks theirs.
oneFileAtATime("vps-backup-schedules");
const id=`audit-r2-backup-${randomUUID()}`;
beforeAll(async()=>{
 const db=new URL(process.env.DATABASE_URL!);
 if(!["localhost","127.0.0.1","[::1]"].includes(db.hostname)||!/audit|test|_ci/.test(db.pathname))throw new Error("dedicated audit DB only");
 await prisma.team.create({data:{id,name:id,slug:id}});
 await prisma.user.create({data:{id,username:id,passwordHash:"not-a-login",status:"DISABLED",mustChangePassword:false}});
 await prisma.identityTemplate.create({data:{id,name:id,permissions:["server:write"]}});
 await prisma.teamMember.create({data:{userId:id,teamId:id,identityTemplateId:id}});
 await prisma.server.create({data:{id,teamId:id,name:id,host:"fixture.invalid",username:"fixture",enabled:true,operatingSystem:"LINUX",tags:[]}});
});
afterAll(async()=>{
 await prisma.job.deleteMany({where:{teamId:id}});
 await prisma.server.deleteMany({where:{id}});
 await prisma.user.deleteMany({where:{id}});
 await prisma.team.deleteMany({where:{id}});
 await prisma.identityTemplate.deleteMany({where:{id}});
 await prisma.$disconnect();
});
it.each([
 {label:"disabled owner",disabled:true,deleted:false},
 {label:"deleted customer",disabled:false,deleted:true},
 {label:"both revoked",disabled:true,deleted:true},
])("$label refuses queued VPS backup before remote dispatch",async({disabled,deleted})=>{
 remote.exec.mockClear();
 await prisma.user.update({where:{id},data:{status:disabled?"DISABLED":"ACTIVE"}});
 await prisma.team.update({where:{id},data:{deletedAt:deleted?new Date():null}});
 const record=await prisma.vpsBackupRecord.create({data:{serverId:id,createdBy:id,backupType:"nginx-config",status:"PENDING"}});
 // Not claimable until this test makes it so: the integration suites share one
 // database and another file's runVpsBackupJobWorkerOnce() must not pick this
 // job up (a global LIMIT-1 claim) before the assertions below run.
 const job=await prisma.job.create({data:{type:"vps-backup.create",title:id,teamId:id,createdBy:id,maxAttempts:1,payload:{recordId:record.id,serverId:id,teamId:id},availableAt:new Date(Date.now()+60_000)}});
 // Park every other claimable job of this type first, then make only ours due:
 // the claim orders by availableAt, so another suite's older pending job would
 // otherwise be taken instead of this one.
 await prisma.job.updateMany({where:{type:"vps-backup.create",id:{not:job.id},status:"PENDING",availableAt:{lte:new Date()}},data:{availableAt:new Date(Date.now()+120_000)}});
 await prisma.job.update({where:{id:job.id},data:{availableAt:new Date()}});
 await runVpsBackupJobWorkerOnce();
 expect(remote.exec).not.toHaveBeenCalled();
 expect((await prisma.job.findUniqueOrThrow({where:{id:job.id}})).status).toBe("FAILED");
 expect((await prisma.vpsBackupRecord.findUniqueOrThrow({where:{id:record.id}})).errorMessage).not.toContain("audit intentionally stopped");
});
it("permits an active owner in a live customer to reach dispatch",async()=>{
 remote.exec.mockClear();
 await prisma.user.update({where:{id},data:{status:"ACTIVE"}});
 await prisma.team.update({where:{id},data:{deletedAt:null}});
 const record=await prisma.vpsBackupRecord.create({data:{serverId:id,createdBy:id,backupType:"nginx-config",status:"PENDING"}});
 const job=await prisma.job.create({data:{type:"vps-backup.create",title:id,teamId:id,createdBy:id,maxAttempts:1,payload:{recordId:record.id,serverId:id,teamId:id},availableAt:new Date(Date.now()+60_000)}});
 await prisma.job.updateMany({where:{type:"vps-backup.create",id:{not:job.id},status:"PENDING",availableAt:{lte:new Date()}},data:{availableAt:new Date(Date.now()+120_000)}});
 await prisma.job.update({where:{id:job.id},data:{availableAt:new Date()}});
 await runVpsBackupJobWorkerOnce();
 expect(remote.exec).toHaveBeenCalled();
 expect((await prisma.vpsBackupRecord.findUniqueOrThrow({where:{id:record.id}})).errorMessage).toContain("audit intentionally stopped");
 expect((await prisma.job.findUniqueOrThrow({where:{id:job.id}})).status).toBe("FAILED");
});
it("scheduled VPS backup preserves its creator in both job and record",async()=>{
 await prisma.team.update({where:{id},data:{deletedAt:null}});
 // The integration suites share this database and dispatchDueVpsBackupSchedules()
 // sweeps every due schedule, not only this file's: park any other ACTIVE
 // schedule that is due right now so the dispatch below is this file's alone.
 // Only those are made ACTIVE again afterwards: a schedule another file paused on purpose stays paused.
 const parked=(await prisma.vpsBackupSchedule.findMany({where:{status:"ACTIVE",nextRunAt:{lte:new Date()},serverId:{not:id}},select:{id:true}})).map((s)=>s.id);
 await prisma.vpsBackupSchedule.updateMany({where:{id:{in:parked},status:"ACTIVE"},data:{status:"PAUSED"}});
 try{
  const schedule=await prisma.vpsBackupSchedule.create({data:{serverId:id,createdById:id,name:id,cronExpression:"0 3 * * *",backupType:"nginx-config",paths:[],nextRunAt:new Date(0)}});
  // One dispatch of the whole due set: this file's schedule must be among what it created.
  await dispatchDueVpsBackupSchedules();
  const record=await prisma.vpsBackupRecord.findFirstOrThrow({where:{scheduleId:schedule.id}});
  const job=await prisma.job.findFirstOrThrow({where:{teamId:id,payload:{path:["recordId"],equals:record.id}}});
  expect(record.createdBy).toBe(id);expect(job.createdBy).toBe(id);
 }finally{
  await prisma.vpsBackupSchedule.updateMany({where:{id:{in:parked},status:"PAUSED"},data:{status:"ACTIVE"}});
 }
});

});
