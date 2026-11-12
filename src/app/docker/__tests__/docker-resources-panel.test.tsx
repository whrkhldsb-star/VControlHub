import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerResourcesPanel } from "../docker-resources-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function wrap(serverId: string) {
  return (
    <I18nProvider initialLocale="zh">
      <DockerResourcesPanel serverId={serverId} />
    </I18nProvider>
  );
}

describe("DockerResourcesPanel", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("does not let a completed mutation refresh and overwrite a newly selected server", async () => {
    const user = userEvent.setup();
    const createRequest = deferred<{ ok: true }>();
    let oldServerNetworkLoads = 0;

    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if ((init as RequestInit | undefined)?.method === "POST") {
        return createRequest.promise;
      }
      if (url.includes("serverId=server-a") && url.includes("type=networks")) {
        oldServerNetworkLoads += 1;
        return { data: [{ Name: "network-a", Driver: "bridge", Scope: "local" }] };
      }
      if (url.includes("serverId=server-a") && url.includes("type=volumes")) {
        return { data: { Volumes: [] } };
      }
      if (url.includes("serverId=server-b") && url.includes("type=networks")) {
        return { data: [{ Name: "network-b", Driver: "bridge", Scope: "local" }] };
      }
      if (url.includes("serverId=server-b") && url.includes("type=volumes")) {
        return { data: { Volumes: [] } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(wrap("server-a"));
    expect(await screen.findByText("network-a")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "名称" }), "new-network");
    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
      "/api/docker/resources",
      expect.objectContaining({ method: "POST" }),
    ));

    view.rerender(wrap("server-b"));
    expect(await screen.findByText("network-b")).toBeInTheDocument();

    createRequest.resolve({ ok: true });

    await waitFor(() => expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(""));
    expect(screen.getByText("network-b")).toBeInTheDocument();
    expect(screen.queryByText("network-a")).not.toBeInTheDocument();
    expect(oldServerNetworkLoads).toBe(1);
  });

  it("shows a failed deletion in the confirmation dialog, where the person is looking", async () => {
    // The reason was written into the card behind the dialog, which stayed open as if nothing had happened.
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/http/api-client-error");
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        throw new ApiError(409, { code: "CONFLICT", error: "Conflict", message: "数据卷 cache 正在被容器使用" });
      }
      return String(input).includes("type=volumes") ? { data: { Volumes: [{ Name: "cache", Driver: "local" }] } } : { data: [] };
    });
    render(wrap("srv_1"));

    await user.click(await screen.findByRole("button", { name: "删除 数据卷 cache" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(await within(dialog).findByText("数据卷 cache 正在被容器使用")).toBeInTheDocument();

    // Asking again starts clean.
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "删除 数据卷 cache" }));
    expect(within(screen.getByRole("dialog")).queryByText("数据卷 cache 正在被容器使用")).not.toBeInTheDocument();
    expect(screen.queryByText("数据卷 cache 正在被容器使用")).not.toBeInTheDocument();
  });

  it("does not open the previous server's inspect result over a newly selected server", async () => {
    const user = userEvent.setup();
    const inspect = deferred<{ data: { Name: string; Marker: string } }>();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("name=")) return inspect.promise;
      const server = url.includes("serverId=server-a") ? "a" : "b";
      if (url.includes("type=networks")) return { data: [{ Name: `shared-net`, Driver: "bridge", Scope: server }] };
      return { data: { Volumes: [] } };
    });

    const view = render(wrap("server-a"));
    await user.click(await screen.findByRole("button", { name: /查看.*shared-net/ }));
    view.rerender(wrap("server-b"));
    await screen.findByText("shared-net");

    inspect.resolve({ data: { Name: "shared-net", Marker: "from-server-a" } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/from-server-a/)).not.toBeInTheDocument();
  });
});

