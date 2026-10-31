import { expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  failJobTerminalMock,
  heartbeatJobMock,
  runVpsBackupRecordMock,
  forceFailVpsBackupRecordIfRunningMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  failJobTerminalMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  runVpsBackupRecordMock: vi.fn(),
  forceFailVpsBackupRecordIfRunningMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  failJobTerminal: failJobTerminalMock,
  heartbeatJob: heartbeatJobMock,
}));

vi.mock("../vps-backup-service", () => ({
  runVpsBackupRecord: runVpsBackupRecordMock,
  forceFailVpsBackupRecordIfRunning: forceFailVpsBackupRecordIfRunningMock,
  VPS_BACKUP_CREATE_JOB_TYPE: "vps-backup.create",
}));

const { runVpsBackupJobWorkerOnce } = await import("../vps-backup-job-worker");

function failure(errorMessage: string) {
  return {
    success: false,
    fileSize: null,
    checksumSha256: null,
    localPath: null,
    remotePath: null,
    errorMessage,
  };
}


it("first VPS backup heartbeat preserves its claimed lease with renewal headroom", async () => {
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-31T03:00:00Z"));
 const start=Date.now();let deadline=start+30*60_000;let release!:()=>void;
 claimNextJobMock.mockResolvedValue({id:"job",payload:{recordId:"rec"}});
 heartbeatJobMock.mockImplementation(async (_id,_worker,options) => { deadline=Date.now()+(options?.leaseMs??5*60_000);return {count:1}; });
 runVpsBackupRecordMock.mockImplementation(()=>new Promise(resolve=>{release=()=>resolve(failure("controlled finish"));}));
 const task=runVpsBackupJobWorkerOnce();
 await vi.advanceTimersByTimeAsync(1);
 expect(deadline-start).toBe(1_800_000);
 expect(heartbeatJobMock).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(299_998);
 expect(heartbeatJobMock).toHaveBeenCalledTimes(1);
 release();await task;vi.useRealTimers();
});
