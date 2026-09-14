import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({guard:vi.fn(),permission:vi.fn(),listing:vi.fn(),formOptions:vi.fn(),browser:vi.fn()}));
vi.mock("@/lib/auth/page-guard",() => ({requirePagePermission:mocks.guard}));
vi.mock("@/lib/auth/authorization",() => ({sessionHasPermission:mocks.permission}));
vi.mock("@/lib/files/listing-service",() => ({getFilesListing:mocks.listing}));
vi.mock("@/app/storage/actions",() => ({getStorageFormOptions:mocks.formOptions}));
vi.mock("@/lib/i18n/translations",() => ({getServerLocale:async () => "zh",t:(key:string) => key}));
vi.mock("../files-browser-spa",() => ({FilesBrowserSpa:mocks.browser}));
vi.mock("../storage-node-manager",() => ({StorageNodeManager:() => null}));
vi.mock("../files-more-nav",() => ({FilesMoreNav:() => null}));
import FilesPage from "../page";
const session = {userId:"viewer",username:"viewer",roles:["viewer"]};
const listing = {
  nodeIdFilter:"one",currentPath:"docs",folders:[],files:[{id:"late-file",relativePath:"docs/late.txt",updatedAt:"now"}],
  pagination:{page:12,pageSize:100,totalItems:1208,totalPages:13},searchQuery:"",searchScope:"current",sort:"name",direction:"asc",
  stats:{totalNodes:2,totalEntries:1208,totalItems:1208,deletedEntries:8},
};
beforeEach(() => {
  vi.resetAllMocks();mocks.guard.mockResolvedValue(session);mocks.permission.mockReturnValue(false);
  mocks.listing.mockResolvedValue({listing,nodes:[]});mocks.formOptions.mockResolvedValue({servers:[],nodes:[]});
  mocks.browser.mockImplementation(() => <div data-testid="file-browser" />);
});
describe("FilesPage",() => {
  it("renders the same paginated payload as the refresh service",async () => {
    render(await FilesPage({searchParams:Promise.resolve({nodeId:"one",path:"docs",page:"12"})}));
    expect(mocks.guard).toHaveBeenCalledWith("storage:read",{redirectTo:"/files"});
    expect(mocks.listing).toHaveBeenCalledWith(session,expect.objectContaining({nodeId:"one",path:"docs",page:12,pageSize:100}));
    expect(mocks.browser).toHaveBeenCalledWith(expect.objectContaining({initialData:listing}),undefined);
    expect(mocks.browser.mock.calls[0]![0].children.props.canManageNodes).toBe(false);
  });
  it("does not fetch privileged form options for a read-only viewer",async () => {
    await FilesPage({});expect(mocks.formOptions).not.toHaveBeenCalled();
  });
  it("loads storage management options when authorized",async () => {
    mocks.permission.mockReturnValue(true);await FilesPage({});expect(mocks.formOptions).toHaveBeenCalledOnce();
  });
  it("stops before reading any data when the page guard rejects",async () => {
    mocks.guard.mockRejectedValue(new Error("Forbidden"));
    await expect(FilesPage({})).rejects.toThrow("Forbidden");expect(mocks.listing).not.toHaveBeenCalled();
  });
});
