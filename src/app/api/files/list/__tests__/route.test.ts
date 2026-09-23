import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({permission:vi.fn(),listing:vi.fn()}));
vi.mock("@/lib/auth/require-api-permission",() => ({requireApiPermission:mocks.permission}));
vi.mock("@/lib/files/listing-service",() => ({getFilesListing:mocks.listing}));
import { GET } from "../route";
const session = {userId:"viewer",username:"viewer",roles:["viewer"]};
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({session}); mocks.listing.mockResolvedValue({listing:{currentPath:"docs",pagination:{page:2,pageSize:50,totalItems:1208}}}); });
describe("GET /api/files/list",() => {
  it("delegates validated scope, page and sorting to the shared SSR service",async () => {
    const response = await GET(new NextRequest("https://app.example.test/api/files/list?nodeId=one&path=docs&page=2&pageSize=50&sort=size&direction=desc"));
    expect(response.status).toBe(200);
    expect(mocks.listing).toHaveBeenCalledWith(session,{nodeId:"one",path:"docs",scope:"current",page:2,pageSize:50,sort:"size",direction:"desc",sync:"1"});
    expect(await response.json()).toEqual({currentPath:"docs",pagination:{page:2,pageSize:50,totalItems:1208}});
  });
  it.each(["page=0","page=-1","page=1.5","pageSize=201","pageSize=0","sort=unknown"])("rejects invalid bounded pagination: %s",async (query) => {
    const response = await GET(new NextRequest(`https://app.example.test/api/files/list?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.listing).not.toHaveBeenCalled();
  });
  it("does not query listings without a session",async () => {
    // Real requireApiPermission answers an absent session with a 401 Response
    // (never { session: null }) — the guard rejects before the handler runs.
    mocks.permission.mockResolvedValue(new Response(JSON.stringify({error:"not authenticated"}),{status:401}));
    const response = await GET(new NextRequest("https://app.example.test/api/files/list"));
    expect(response.status).toBe(401);
    expect(mocks.listing).not.toHaveBeenCalled();
  });
});
