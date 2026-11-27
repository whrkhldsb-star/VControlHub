import { expect, it, vi } from "vitest";
import { agentPublishGuard, callFileAgent } from "@/lib/storage/agent-file-queue";
import { lockDownloadClaim } from "../claim";

const mocks = vi.hoisted(() => ({ query: vi.fn(async () => []), enqueue: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (body: (tx: unknown) => unknown) => body({
  $queryRaw: mocks.query, agentFileCall: { create: mocks.enqueue },
}) } }));

it("refuses the final Agent queue handoff when the worker has lost its job claim", async () => {
  await expect(agentPublishGuard.run(tx => lockDownloadClaim(tx, { id: "job", workerId: "worker", attempts: 3 }), () =>
    callFileAgent("node", { id: "binding", tokenHash: "token", writable: true }, { op: "publish", path: "target" })))
    .rejects.toMatchObject({ name: "LeaseLostError" });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
