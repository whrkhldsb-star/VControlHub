import { render, screen, waitFor } from "@testing-library/react";
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
});
