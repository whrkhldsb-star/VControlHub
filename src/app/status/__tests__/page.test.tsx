/**
 * /status page exposure:
 * - board closed, anonymous: overall summary only (no checks, no uptime, no nodes)
 * - board open: the public board from the shared projection; a session adds
 *   the internal section, which guest preview hides again
 * - ?preview=1 only bypasses the closed switch for platform administrators
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.fn();
const getPublicStatusMock = vi.fn();
const getPublicStatusSummaryMock = vi.fn();
const getAllUptimeDataInternalMock = vi.fn();
const readPublicBoardMock = vi.fn();

vi.mock("@/lib/auth/server-session", () => ({
  getCurrentSession: getCurrentSessionMock,
}));
vi.mock("@/lib/status/service", () => ({
  getPublicStatus: getPublicStatusMock,
  getPublicStatusSummary: getPublicStatusSummaryMock,
}));
vi.mock("@/lib/uptime/internal", () => ({
  getAllUptimeDataInternal: getAllUptimeDataInternalMock,
}));
vi.mock("@/lib/public-status/read", () => ({
  readPublicBoard: readPublicBoardMock,
}));
vi.mock("../public-board-client", () => ({
  PublicBoardClient: (props: unknown) => ({ type: "PublicBoardClient", props }),
}));
vi.mock("@/lib/i18n/translations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n/translations")>(
    "@/lib/i18n/translations",
  );
  return {
    ...actual,
    getServerLocale: async () => "en" as const,
  };
});
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const BOARD = { site: { refreshSeconds: 15 }, nodes: [], summary: { total: 0 } };

async function renderTree(element: unknown): Promise<unknown> {
  // Resolve async server components (ClosedBoard / InternalStatusSection) for inspection.
  if (Array.isArray(element)) return Promise.all(element.map(renderTree));
  if (!element || typeof element !== "object") return element;
  const node = element as { type?: unknown; props?: Record<string, unknown> };
  if (typeof node.type === "function" && /^(ClosedBoard|InternalStatusSection)$/.test((node.type as { name: string }).name)) {
    return renderTree(await (node.type as (p: unknown) => Promise<unknown>)(node.props));
  }
  const type = typeof node.type === "function" ? (node.type as { name: string }).name : node.type;
  if (node.props && "children" in node.props) {
    return { ...node, type, props: { ...node.props, children: await renderTree(node.props.children) } };
  }
  return { ...node, type };
}

async function renderPage(params: Record<string, string> = {}) {
  const { default: StatusPage } = await import("../page");
  const tree = await renderTree(await StatusPage({ searchParams: Promise.resolve(params) }));
  return JSON.stringify(tree);
}

describe("/status page exposure", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset();
    getPublicStatusMock.mockReset();
    getPublicStatusSummaryMock.mockReset();
    getAllUptimeDataInternalMock.mockReset();
    readPublicBoardMock.mockReset();
    getPublicStatusSummaryMock.mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "healthy" },
    });
    getPublicStatusMock.mockResolvedValue({
      generatedAt: "2026-07-17T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "warning", total: 2, healthy: 1, warning: 1, critical: 0 },
      checks: [
        { id: "database", label: "Database", status: "healthy", message: "Available" },
        { id: "servers", label: "VPS management", status: "warning", message: "1 VPS instances enabled" },
      ],
    });
    getAllUptimeDataInternalMock.mockResolvedValue({
      servers: [{ id: "s1", name: "edge-1", data: [{ date: "2026-07-16", uptimePercent: 100, checkCount: 288, onlineMinutes: 1440, offlineMinutes: 0 }] }],
    });
  });

  it("anonymous with the board closed: summary only, no tenant uptime data", async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    readPublicBoardMock.mockResolvedValue(null);
    const html = await renderPage();
    expect(readPublicBoardMock).toHaveBeenCalledWith(expect.anything(), { preview: false });
    expect(getPublicStatusSummaryMock).toHaveBeenCalledTimes(1);
    expect(getPublicStatusMock).not.toHaveBeenCalled();
    expect(getAllUptimeDataInternalMock).not.toHaveBeenCalled();
    expect(html).not.toMatch(/Database|VPS management|edge-1|Historical uptime/);
    expect(html).toMatch(/Service Status/);
    expect(html).toContain("/login?next=%2F");
  });

  it("anonymous with the board open: the public board only", async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    readPublicBoardMock.mockResolvedValue(BOARD);
    const html = await renderPage();
    expect(html).toContain("PublicBoardClient");
    expect(getPublicStatusMock).not.toHaveBeenCalled();
    expect(getAllUptimeDataInternalMock).not.toHaveBeenCalled();
  });

  it("signed in: the board plus the internal checks and customer uptime", async () => {
    getCurrentSessionMock.mockResolvedValue({ userId: "u1", roles: ["admin"] });
    readPublicBoardMock.mockResolvedValue(BOARD);
    const html = await renderPage();
    expect(html).toContain("PublicBoardClient");
    expect(getAllUptimeDataInternalMock).toHaveBeenCalledTimes(1);
    expect(html).toMatch(/Database/);
    expect(html).toMatch(/edge-1/);
  });

  it("guest preview: administrators bypass the closed switch and see no internal data", async () => {
    getCurrentSessionMock.mockResolvedValue({ userId: "u1", roles: ["admin"] });
    readPublicBoardMock.mockResolvedValue(BOARD);
    const html = await renderPage({ preview: "1" });
    expect(readPublicBoardMock).toHaveBeenCalledWith(expect.anything(), { preview: true });
    expect(getAllUptimeDataInternalMock).not.toHaveBeenCalled();
    expect(html).not.toMatch(/Database/);
  });

  it("preview is ignored for customer accounts and visitors", async () => {
    getCurrentSessionMock.mockResolvedValue({ userId: "u2", roles: ["user"], currentTeamId: "t1" });
    readPublicBoardMock.mockResolvedValue(null);
    await renderPage({ preview: "1" });
    expect(readPublicBoardMock).toHaveBeenCalledWith(expect.anything(), { preview: false });
    getCurrentSessionMock.mockResolvedValue(null);
    await renderPage({ preview: "1" });
    expect(readPublicBoardMock).toHaveBeenLastCalledWith(expect.anything(), { preview: false });
  });
});

describe("uptime presentation", () => {
  it("distinguishes a sampled 0% outage from a day with no sample", async () => {
    const { getUptimeColorClass } = await import("../uptime-presentation");
    expect(getUptimeColorClass(0, true)).toBe("bg-[var(--danger)]");
    expect(getUptimeColorClass(0, false)).toBe("bg-[var(--surface-hover)]");
  });

  it("weights SLA by covered time instead of treating sparse days equally", async () => {
    const { calculateWeightedSla } = await import("../uptime-presentation");
    expect(
      calculateWeightedSla([
        { uptimePercent: 100, checkCount: 288, onlineMinutes: 1440, offlineMinutes: 0 },
        { uptimePercent: 0, checkCount: 1, onlineMinutes: 0, offlineMinutes: 5 },
      ]),
    ).toBe(99.65);
    expect(calculateWeightedSla([])).toBeNull();
  });

  it("does not present a day with one online sample as a 100% day", async () => {
    const { describeUptimeDay, expectedMinutesForDay, getUptimeColorClass } = await import("../uptime-presentation");
    const sparse = describeUptimeDay({ uptimePercent: 100, checkCount: 1, onlineMinutes: 5, offlineMinutes: 0 }, expectedMinutesForDay());
    expect(sparse).toMatchObject({ sampled: true, sufficient: false, coveragePercent: 0, unknownMinutes: 1435 });
    expect(getUptimeColorClass(100, sparse.sampled, sparse.sufficient)).not.toContain("success");
    const full = describeUptimeDay({ uptimePercent: 100, checkCount: 288, onlineMinutes: 1440, offlineMinutes: 0 }, expectedMinutesForDay());
    expect(full).toMatchObject({ sufficient: true, coveragePercent: 100, unknownMinutes: 0 });
    // Today is judged against the time elapsed so far (06:00 → 360 minutes).
    expect(describeUptimeDay({ uptimePercent: 100, checkCount: 70, onlineMinutes: 350, offlineMinutes: 0 }, expectedMinutesForDay(360))).toMatchObject({ sufficient: true });
  });

  it("judges coverage by minutes, so a longer sampling interval is not 'insufficient'", async () => {
    const { describeUptimeDay, expectedMinutesForDay } = await import("../uptime-presentation");
    // 15-minute cadence: 96 samples cover the whole day.
    expect(describeUptimeDay({ uptimePercent: 100, checkCount: 96, onlineMinutes: 1440, offlineMinutes: 0 }, expectedMinutesForDay())).toMatchObject({ sufficient: true, coveragePercent: 100 });
    // Rows without minutes fall back to the former fixed 5-minute cadence.
    expect(describeUptimeDay({ uptimePercent: 100, checkCount: 144 }, expectedMinutesForDay())).toMatchObject({ coveragePercent: 50 });
  });

  it("reports window coverage from the first sampled day on", async () => {
    const { calculateWindowCoverage } = await import("../uptime-presentation");
    expect(calculateWindowCoverage([
      { uptimePercent: 0, checkCount: 0, onlineMinutes: 0, offlineMinutes: 0, expectedMinutes: 1440 },
      { uptimePercent: 100, checkCount: 288, onlineMinutes: 1440, offlineMinutes: 0, expectedMinutes: 1440 },
      { uptimePercent: 100, checkCount: 1, onlineMinutes: 5, offlineMinutes: 0, expectedMinutes: 1440 },
    ])).toMatchObject({ coveragePercent: 50, sufficient: true });
    expect(calculateWindowCoverage([{ uptimePercent: 100, checkCount: 3, onlineMinutes: 15, offlineMinutes: 0, expectedMinutes: 1440 }])).toMatchObject({ sufficient: false });
    expect(calculateWindowCoverage([{ uptimePercent: 0, checkCount: 0, expectedMinutes: 1440 }])).toBeNull();
  });
});
