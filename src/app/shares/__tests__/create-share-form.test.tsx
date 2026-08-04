import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { t } from "@/lib/i18n/translations";
import { CreateShareForm } from "../create-share-form";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/i18n/use-locale", () => ({
  useI18n: () => ({ locale: "zh", t: (key: string, vars?: Record<string, string | number>) => t(key, "zh", vars) }),
}));

const mockedFetch = vi.mocked(csrfFetch);

describe("CreateShareForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue({ token: "public-token" });
  });

  it("submits the maximum download count for downloadable shares", async () => {
    const user = userEvent.setup();
    render(<CreateShareForm nodes={[{ id: "node_1", name: "Local" }]} />);

    await user.click(screen.getByRole("button", { name: "高级创建分享链接" }));
    await user.type(screen.getByLabelText("访问路径"), "docs/report.pdf");
    await user.selectOptions(screen.getByLabelText("分享类型"), "FILE");
    await user.type(screen.getByLabelText("最大下载次数（空=不限）"), "3");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(mockedFetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      storageNodeId: "node_1",
      path: "docs/report.pdf",
      entryType: "FILE",
      permissionLevel: "download",
      maxDownloads: 3,
    });
  });

  it("removes download-only controls when switching to metadata-only mode", async () => {
    const user = userEvent.setup();
    render(<CreateShareForm nodes={[{ id: "node_1", name: "Local" }]} />);

    await user.click(screen.getByRole("button", { name: "高级创建分享链接" }));
    await user.type(screen.getByLabelText("最大下载次数（空=不限）"), "2");
    await user.type(screen.getByLabelText("访问密码（可选）"), "secret");
    await user.selectOptions(screen.getByLabelText("权限级别"), "preview");

    expect(screen.queryByLabelText("最大下载次数（空=不限）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("访问密码（可选）")).not.toBeInTheDocument();
    expect(screen.getByText(/仅查看模式会展示目录和文件元数据/)).toBeInTheDocument();
  });
});
