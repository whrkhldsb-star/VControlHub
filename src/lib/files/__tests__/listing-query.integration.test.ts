// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { queryFileListing, queryFolderCounts } from "../listing-query";
import { getFileIndexStatistics } from "@/lib/storage/service-statistics";
import { readDirectoryIndex } from "@/lib/storage/directory-index";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";
describe.skipIf(!enabled)("File listing PostgreSQL integration", () => {
  const nodeId = `listing-audit-${randomUUID()}`;
  const secondNodeId = `listing-audit-${randomUUID()}`;
  let fixturesCreated = false;
  const query = (overrides:Partial<Parameters<typeof queryFileListing>[0]> = {}) => queryFileListing({
    nodeIds:[nodeId],path:"",query:"",recursive:false,page:1,pageSize:100,...overrides,
  });
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1","localhost","[::1]"].includes(database.hostname) || !/audit|test/.test(database.pathname)) {
      throw new Error("File listing integration requires a loopback audit/test database");
    }
    await prisma.storageNode.createMany({data:[nodeId,secondNodeId].map((id) => ({id,name:id,driver:"LOCAL",basePath:"/nonexistent-listing-fixture"}))});
    fixturesCreated = true;
    await prisma.fileEntry.createMany({data:[
      ...Array.from({length:1205},(_,index) => ({
        storageNodeId:nodeId,relativePath:`file-${String(index).padStart(4,"0")}.txt`,name:`file-${String(index).padStart(4,"0")}.txt`,
        entryType:"FILE" as const,mimeType:"text/plain",size:BigInt(index),
      })),
      {storageNodeId:nodeId,relativePath:"目录%_/nested/last.PNG",name:"last.PNG",entryType:"FILE",mimeType:null,size:BigInt(12)},
      {storageNodeId:nodeId,relativePath:"目录XX/nested/other.txt",name:"other.txt",entryType:"FILE",mimeType:"text/plain",size:BigInt(12)},
      {storageNodeId:nodeId,relativePath:"empty",name:"empty",entryType:"DIRECTORY",mimeType:"inode/directory",size:null},
      {storageNodeId:nodeId,relativePath:"deleted.txt",name:"deleted.txt",entryType:"FILE",mimeType:"text/plain",size:BigInt(1),isDeleted:true},
      {storageNodeId:secondNodeId,relativePath:"private.txt",name:"private.txt",entryType:"FILE",mimeType:"text/plain",size:BigInt(2)},
    ]});
  },30000);
  afterAll(async () => {
    if (fixturesCreated) {
      await prisma.storageNode.deleteMany({where:{id:{in:[nodeId,secondNodeId]}}});
    }
    await prisma.$disconnect();
  });

  it("returns every item exactly once beyond the old 1000-row cap", async () => {
    const seen = new Set<string>();
    for (let page = 1; page <= 13; page++) {
      const result = await query({page});
      expect(result.total).toBe(1208);
      expect(result.rows.length).toBeLessThanOrEqual(100);
      for (const row of result.rows) {
        expect(seen.has(row.relativePath)).toBe(false);
        seen.add(row.relativePath);
      }
    }
    expect(seen.size).toBe(1208);
    expect(seen.has("file-1204.txt")).toBe(true);
    expect(seen.has("private.txt")).toBe(false);
    expect(seen.has("deleted.txt")).toBe(false);
  });
  it("matches Unicode and SQL wildcard characters literally", async () => {
    const result = await query({path:"目录%_"});
    expect(result.rows.map((row) => row.relativePath)).toEqual(["目录%_/nested"]);
    const recursive = await query({path:"目录%_",query:"last",recursive:true});
    expect(recursive.rows.map((row) => row.relativePath)).toEqual(["目录%_/nested/last.PNG"]);
    expect((await query({query:"%_",recursive:true})).rows.map((row) => row.relativePath)).toEqual(["目录%_"]);
  });
  it("sorts and searches the whole directory before applying pagination", async () => {
    const result = await query({sort:"size",direction:"desc",pageSize:10});
    expect(result.rows.filter((row) => !row.directory)[0]?.name).toBe("file-1204.txt");
    const found = await query({query:"FILE-1204"});
    expect(found.total).toBe(1);
    expect(found.rows[0]?.name).toBe("file-1204.txt");
  });
  it("clamps a stale page after deletion and keeps an empty directory empty", async () => {
    expect((await query({page:999})).page).toBe(13);
    expect(await query({path:"empty",page:4})).toEqual({rows:[],total:0,page:1});
    expect(await query({nodeIds:[]})).toEqual({rows:[],total:0,page:1});
  });
  it("counts implicit directories, descendants and deleted rows accurately", async () => {
    const counts = await queryFolderCounts([{storageNodeId:nodeId,relativePath:"目录%_"},{storageNodeId:nodeId,relativePath:""}]);
    expect(counts.get(`${nodeId}:目录%_`)).toEqual({fileCount:1,folderCount:1});
    expect(counts.get(`${nodeId}:`)).toEqual({fileCount:1207,folderCount:3});
    expect(await getFileIndexStatistics([nodeId])).toEqual({totalEntries:1208,deletedEntries:1,previewableEntries:1207,remoteDirectoryCount:5});
  });

  it("reads only direct index children including tombstones and literal Unicode paths", async () => {
    const root = [];
    for await (const rows of readDirectoryIndex(nodeId, "")) root.push(...rows);
    expect(root).toHaveLength(1207);
    expect(root.some((row) => row.name === "deleted.txt" && row.isDeleted)).toBe(true);
    expect(root.every((row) => !row.relativePath.includes("/"))).toBe(true);
    const nested = [];
    for await (const rows of readDirectoryIndex(nodeId, "目录%_/nested")) nested.push(...rows);
    expect(nested.map((row) => row.relativePath)).toEqual(["目录%_/nested/last.PNG"]);
  });

  it("deduplicates requested folders and isolates counts across nodes and empty directories", async () => {
    const folders = [
      { storageNodeId: nodeId, relativePath: "目录%_" },
      { storageNodeId: nodeId, relativePath: "目录%_" },
      { storageNodeId: nodeId, relativePath: "目录%_/nested" },
      { storageNodeId: nodeId, relativePath: "empty" },
      { storageNodeId: nodeId, relativePath: "missing" },
      { storageNodeId: secondNodeId, relativePath: "" },
    ];
    const counts = await queryFolderCounts(folders);
    expect(counts.size).toBe(5);
    expect(counts.get(`${nodeId}:目录%_`)).toEqual({ fileCount: 1, folderCount: 1 });
    expect(counts.get(`${nodeId}:目录%_/nested`)).toEqual({ fileCount: 1, folderCount: 0 });
    expect(counts.get(`${nodeId}:empty`)).toEqual({ fileCount: 0, folderCount: 0 });
    expect(counts.get(`${nodeId}:missing`)).toEqual({ fileCount: 0, folderCount: 0 });
    expect(counts.get(`${secondNodeId}:`)).toEqual({ fileCount: 1, folderCount: 0 });
  });
});
