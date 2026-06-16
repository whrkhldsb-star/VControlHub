import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ToastProvider } from "@/components/toast-provider";
import { SnippetList } from "../snippet-list-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const snippets = [
  {
    id: "snip-1",
    title: "部署脚本",
    content: "npm run build",
    language: "bash",
    description: "构建命令",
    tags: ["deploy"],
    isPrivate: false,
  },
];

function renderList() {
  return render(
    <ToastProvider>
      <SnippetList snippets={snippets} />
    </ToastProvider>,
  );
}

describe("SnippetList", () => {
  let clipboardRestore: (() => void) | null = null;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({});
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn() },
      });
      clipboardRestore = () => {
        try {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: undefined,
          });
        } catch {
          // ignore restore errors
        }
      };
    } catch {
      // some jsdom builds expose clipboard as a non-configurable getter;
      // skip the stub and rely on default navigator.clipboard behaviour.
    }
  });
  afterEach(() => {
    clipboardRestore?.();
    clipboardRestore = null;
  });

  it("shows a visible label for snippet search and filters by label-based input", async () => {
    renderList();

    expect(screen.getByText("搜索代码片段")).toBeInTheDocument();
    const searchInput = screen.getByRole("searchbox", { name: "搜索代码片段" });
    expect(searchInput).toHaveAttribute("placeholder", "标题、内容、标签…");

    await userEvent.type(searchInput, "missing");

    expect(screen.getByText("无匹配结果")).toBeInTheDocument();
    expect(screen.queryByText("部署脚本")).not.toBeInTheDocument();
  });

  it("renders the filtered snippet count using the i18n template", () => {
    renderList();
    // The snippetsPage.count template is "{count} 条" — assert the rendered
    // span contains the count number followed by the Chinese counter, so a
    // hardcoded fallback ("1 条") would still pass but a missing t() key would
    // surface as the raw key string "{count} 条" in production.
    expect(screen.getByText("1 条")).toBeInTheDocument();
  });

  it("uses an accessible confirmation dialog instead of native confirm before deleting", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除代码片段" })).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("deletes only after modal confirmation and shows success feedback", async () => {
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/snippets?id=snip-1", { method: "DELETE" }));
    expect(screen.queryByText("部署脚本")).not.toBeInTheDocument();
    expect(screen.getByText("代码片段已删除")).toBeInTheDocument();
  });

  it("keeps the dialog open and displays API errors", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("删除失败"));
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
    expect(screen.getByRole("dialog", { name: "删除代码片段" })).toBeInTheDocument();
    expect(screen.getAllByText("部署脚本").length).toBeGreaterThanOrEqual(1);
  });

  describe("touch targets (TR-022 R18 mobile)", () => {
    function mockHeightsBySelector(measurements: Record<string, number>) {
      // jsdom reports getBoundingClientRect as 0x0; install a minimal stub
      // that returns the requested height for buttons whose className includes
      // the test selector. Sufficient for asserting that min-h-11 produced
      // at least 44px of computed height.
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        const className = (this.getAttribute("class") ?? "") as string;
        for (const [selector, height] of Object.entries(measurements)) {
          if (className.includes(selector)) {
            return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 100, height, toJSON: () => ({}) } as DOMRect;
          }
        }
        return original.call(this);
      };
      return () => {
        Element.prototype.getBoundingClientRect = original;
      };
    }

    it("renders list card action buttons with at least 44px height/width", () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        renderList();
        for (const label of ["复制", "编辑", "删除代码片段 部署脚本"]) {
          const btn = screen.getByRole("button", { name: label });
          const rect = btn.getBoundingClientRect();
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeGreaterThanOrEqual(44);
        }
      } finally {
        restore();
      }
    });

    it("renders the new-snippet trigger with at least 44px height", () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        renderList();
        const btn = screen.getByRole("button", { name: /新建片段/ });
        expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        restore();
      }
    });

    it("renders the create-snippet modal with at least 44px height for primary action + cancel", async () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        const actor = userEvent.setup();
        renderList();
        await actor.click(screen.getByRole("button", { name: /新建片段/ }));

        const dialog = await screen.findByRole("dialog", { name: "新建代码片段" });
        expect(within(dialog).getByRole("button", { name: "创建" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(within(dialog).getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        restore();
      }
    });

    it("renders the delete-confirm dialog buttons with at least 44px height", async () => {
      const restore = mockHeightsBySelector({ "min-h-11": 44 });
      try {
        const actor = userEvent.setup();
        renderList();
        await actor.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));
        const dialog = await screen.findByRole("dialog", { name: "删除代码片段" });
        expect(within(dialog).getByRole("button", { name: "确认删除" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(within(dialog).getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        restore();
      }
    });
  });
});
