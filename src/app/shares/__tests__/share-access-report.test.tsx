import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const csrfFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { ShareAccessReport } from "../share-access-report";

const report = { range: { days: 30, action: "all" }, totals: { total: 4, view: 2, download: 1, passwordAttempt: 1, uniqueIps: 2 }, byShare: [{ shareId: "s1", name: "Report", path: "docs/report.pdf", total: 4, view: 2, download: 1, passwordAttempt: 1 }], logs: [] };

describe("ShareAccessReport", () => {
  beforeEach(() => { vi.clearAllMocks(); csrfFetchMock.mockResolvedValue({ report }); });
  it("renders aggregate metrics and reloads filters", async () => {
    const user = userEvent.setup();
    render(<ShareAccessReport />);
    expect(await screen.findByText("Report")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("sharesPage.report.range"), "7");
    await waitFor(() => expect(csrfFetchMock).toHaveBeenLastCalledWith(expect.stringContaining("days=7")));
    expect(screen.getByRole("link", { name: "sharesPage.report.export" })).toHaveAttribute("href", expect.stringContaining("format=csv"));
  });
});
