import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
const mocks = vi.hoisted(() => ({nodes:vi.fn(),entries:vi.fn(),stats:vi.fn(),query:vi.fn(),counts:vi.fn(),capabilities:vi.fn(),permission:vi.fn(),
  localNode:vi.fn(),localSync:vi.fn(),sftpNode:vi.fn(),sftpSync:vi.fn(),webdavNode:vi.fn(),webdavSync:vi.fn(),preferences:vi.fn()}));
vi.mock("@/lib/db",() => ({prisma:{filePreference:{findMany:mocks.preferences}}}));
vi.mock("@/lib/storage/service-nodes",() => ({listStorageNodes:mocks.nodes}));
vi.mock("@/lib/storage/service-entries",() => ({listFileEntries:mocks.entries}));
vi.mock("@/lib/storage/service-statistics",() => ({getFileIndexStatistics:mocks.stats}));
vi.mock("../listing-query",() => ({queryFileListing:mocks.query,queryFolderCounts:mocks.counts}));
vi.mock("@/lib/auth/authorization",() => ({sessionHasPermission:mocks.permission}));
vi.mock("@/lib/storage/access-control",() => ({getStorageAccessCapabilities:mocks.capabilities,
  getStorageAccessCapabilityKey:({storageNodeId,relativePath}:{storageNodeId:string;relativePath:string}) => `${storageNodeId}:${relativePath}`}));
vi.mock("@/lib/storage/local-sync",() => ({getLocalSyncNode:mocks.localNode,syncLocalDirectoryEntries:mocks.localSync}));
vi.mock("@/lib/storage/sftp-sync",() => ({getSftpSyncNode:mocks.sftpNode,syncSftpDirectoryEntries:mocks.sftpSync}));
vi.mock("@/lib/storage/webdav-sync",() => ({getWebDavSyncNode:mocks.webdavNode,syncWebDavDirectoryEntries:mocks.webdavSync}));
vi.mock("@/lib/storage/readable-scope", () => ({ getReadableStorageScope: async () => null, readableStoragePath: () => true }));
import { getFilesListing } from "../listing-service";
import { listFilesQuerySchema } from "../schema";
const session = {userId:"viewer",username:"viewer",roles:["viewer"],mustChangePassword:false} as SessionPayload;
const node = {id:"node_sftp",name:"Remote",driver:"SFTP",isDefault:true};
const file = {id:"last-file",name:"last.txt",entryType:"FILE",mimeType:"text/plain",relativePath:"docs/last.txt",storageNodeId:node.id,
  size:BigInt(12),sizeLabel:"12 B",previewable:true,localEditable:true,directAccess:{mode:"managed-download",href:"/proxy",fallbackHref:"/fallback",description:"Proxy"},
  storageNode:{...node,serverId:"server_1"},updatedAt:"2026-09-07T00:00:00.000Z"};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.nodes.mockResolvedValue([node]);
  mocks.stats.mockResolvedValue({totalEntries:1208,deletedEntries:12,previewableEntries:1200,remoteDirectoryCount:8});
  mocks.counts.mockResolvedValue(new Map());
  mocks.query.mockResolvedValue({rows:[{storageNodeId:node.id,relativePath:file.relativePath,name:file.name,entryId:file.id,directory:false}],total:1208,page:1});
  mocks.entries.mockResolvedValue([file]);
  mocks.capabilities.mockResolvedValue(new Map([[`${node.id}:${file.relativePath}`,{canRead:true,canWrite:false,canDelete:false}]]));
  mocks.permission.mockReturnValue(false);
  mocks.sftpNode.mockResolvedValue(node);
  mocks.sftpSync.mockResolvedValue({errors:[]});
  mocks.preferences.mockResolvedValue([]);
});
describe("shared files listing",() => {
  it("marks the viewer's own starred entries on the page with one query",async () => {
    mocks.preferences.mockResolvedValue([{fileEntryId:file.id}]);
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id}));
    expect(listing.files[0]?.favorite).toBe(true);
    expect(mocks.preferences).toHaveBeenCalledTimes(1);
    expect(mocks.preferences).toHaveBeenCalledWith({where:{userId:"viewer",fileEntryId:{in:[file.id]},favorite:true},select:{fileEntryId:true}});
  });
  it("names each node's customer and file count for the drive's locations",async () => {
    mocks.nodes.mockResolvedValue([{...node,teamName:"Acme",fileCount:7}]);
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id}));
    expect(listing.nodes[0]).toMatchObject({id:node.id,teamName:"Acme",fileCount:7});
  });
  it("keeps the indexed page visible after shallow SFTP sync fails",async () => {
    mocks.sftpSync.mockResolvedValue({errors:["Remote unavailable"]});
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id}));
    expect(listing.syncWarning).toBe("Remote unavailable");
    expect(listing.stats.totalEntries).toBe(1208);
    expect(listing.files[0]).toMatchObject({id:file.id,storageNodeServerId:"server_1",directAccessFallbackHref:"/fallback",capabilities:{canRead:true,canWrite:false}});
    expect(mocks.entries).toHaveBeenCalledWith(undefined,{ids:[file.id],take:100},session);
  });
  it("syncs for read-only browsing before querying the requested page",async () => {
    await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id,path:"docs",page:12,pageSize:50}));
    expect(mocks.sftpSync).toHaveBeenCalledWith({node,remotePath:"docs",recursive:false,maxDepth:1});
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({nodeIds:[node.id],path:"docs",page:12,pageSize:50}));
    expect(mocks.sftpSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]!);
  });
  it("pages the existing index without remote I/O when sync is disabled",async () => {
    await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id,path:"docs",page:2,sync:"0"}));
    expect(mocks.sftpSync).not.toHaveBeenCalled();
    expect(mocks.sftpNode).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({page:2}));
  });
  it("normalizes grouped navigation into the node and relative path",async () => {
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({path:`Remote__${node.id.slice(0,8)}/docs`}));
    expect(listing.currentPath).toBe("docs");
    expect(listing.nodeIdFilter).toBe(node.id);
    expect(mocks.sftpSync).toHaveBeenCalledWith(expect.objectContaining({remotePath:"docs"}));
  });
  it("returns virtual node roots with aggregate counts and no root mutation capability",async () => {
    mocks.counts.mockResolvedValue(new Map([[`${node.id}:`,{fileCount:1200,folderCount:8}]]));
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({}));
    expect(listing.folders[0]).toMatchObject({displayName:"Remote (SFTP)",fileCount:1200,folderCount:8,storageNodeId:null,capabilities:null});
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sftpSync).not.toHaveBeenCalled();
  });
  it("rejects inaccessible nodes before syncing or querying their contents",async () => {
    await expect(getFilesListing(session,listFilesQuerySchema.parse({nodeId:"other-team"}))).rejects.toThrow("Storage node not found");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sftpSync).not.toHaveBeenCalled();
  });
  it.each(["../etc","docs/../../etc","docs/./item"])("rejects traversal %s before synchronization",async (path) => {
    await expect(getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id,path}))).rejects.toThrow("Invalid directory path");
    expect(mocks.sftpSync).not.toHaveBeenCalled();
  });
  it.each(["LOCAL","WEBDAV"])("synchronizes %s with the same page contract",async (driver) => {
    const selected = {...node,driver};
    mocks.nodes.mockResolvedValue([selected]);
    const getNode = driver === "LOCAL" ? mocks.localNode : mocks.webdavNode;
    const sync = driver === "LOCAL" ? mocks.localSync : mocks.webdavSync;
    getNode.mockResolvedValue(selected);
    sync.mockResolvedValue({errors:[]});
    await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id,path:"docs"}));
    expect(sync).toHaveBeenCalledWith({node:selected,relativePath:"docs"});
  });
  it("uses the database folder summary and returns only the current tree branch",async () => {
    mocks.query.mockResolvedValue({rows:[{storageNodeId:node.id,relativePath:"docs/nested",name:"nested",entryId:null,directory:true}],total:1,page:1});
    mocks.counts.mockResolvedValue(new Map([[`${node.id}:docs/nested`,{fileCount:1008,folderCount:3}],[`${node.id}:docs`,{fileCount:1200,folderCount:8}]]));
    const {listing} = await getFilesListing(session,listFilesQuerySchema.parse({nodeId:node.id,path:"docs"}));
    expect(listing.files).toEqual([]);
    expect(listing.folders[0]).toMatchObject({name:"nested",fileCount:1008,folderCount:3});
    expect(listing.tree.children[0]).toMatchObject({path:"docs",fileCount:1200,children:[expect.objectContaining({path:"docs/nested",children:[]})]});
    expect(mocks.entries).not.toHaveBeenCalled();
  });
});
