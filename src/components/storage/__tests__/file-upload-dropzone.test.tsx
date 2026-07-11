import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { FileUploadDropzone } from "../file-upload-dropzone";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const localNode = { id: "node_local", name: "本机存储", driver: "LOCAL" };
const sftpNode = { id: "node_sftp", name: "远端媒体库", driver: "SFTP" };

describe("FileUploadDropzone", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    vi.restoreAllMocks();
  });

  it("calls the client refresh callback after a successful upload", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ relativePath: "docs/report.txt", size: 12 }),
    } as Response);

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="docs"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello world!"], "report.txt", {
      type: "text/plain",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onUploadComplete).toHaveBeenCalledWith({
        relativePath: "docs/report.txt",
        size: 12,
      }),
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByText(/上传完成：docs\/report\.txt/)).toBeInTheDocument();
  });

  it("enables folder selection and preserves browser-provided relative paths", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const formData = init?.body as FormData;
        const relativePath = String(formData.get("relativePath"));
        const file = formData.get("file") as File;
        return {
          ok: true,
          json: async () => ({ relativePath, size: file.size }),
        } as Response;
      });

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="uploads"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const directoryInput = screen.getByLabelText(
      "选择整个文件夹",
    ) as HTMLInputElement;
    expect(directoryInput).toHaveAttribute("webkitdirectory");
    expect(directoryInput).toHaveAttribute("directory");
    expect(fileInput).not.toBe(directoryInput);

    const readme = new File(["readme"], "README.md", { type: "text/markdown" });
    Object.defineProperty(readme, "webkitRelativePath", {
      value: "project/README.md",
    });
    const nested = new File(["nested"], "app.ts", { type: "text/typescript" });
    Object.defineProperty(nested, "webkitRelativePath", {
      value: "project/src/app.ts",
    });

    fireEvent.change(directoryInput, { target: { files: [readme, nested] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const uploadedPaths = fetchMock.mock.calls.map((call) =>
      String((call[1]?.body as FormData).get("relativePath")),
    );
    expect(uploadedPaths).toEqual([
      "uploads/project/README.md",
      "uploads/project/src/app.ts",
    ]);
    expect(onUploadComplete).toHaveBeenNthCalledWith(1, {
      relativePath: "uploads/project/README.md",
      size: readme.size,
    });
    expect(onUploadComplete).toHaveBeenNthCalledWith(2, {
      relativePath: "uploads/project/src/app.ts",
      size: nested.size,
    });
    expect(screen.getByText("上传完成 2/2 个文件")).toBeInTheDocument();
  });

  it("uploads multiple selected files and reports per-file queue status", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const formData = init?.body as FormData;
        const relativePath = String(formData.get("relativePath"));
        const file = formData.get("file") as File;
        return {
          ok: true,
          json: async () => ({ relativePath, size: file.size }),
        } as Response;
      });

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="docs"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");

    const first = new File(["alpha"], "a.txt", { type: "text/plain" });
    const second = new File(["beta"], "b.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onUploadComplete).toHaveBeenCalledTimes(2);
    expect(onUploadComplete).toHaveBeenNthCalledWith(1, {
      relativePath: "docs/a.txt",
      size: first.size,
    });
    expect(onUploadComplete).toHaveBeenNthCalledWith(2, {
      relativePath: "docs/b.txt",
      size: second.size,
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByText("上传完成 2/2 个文件")).toBeInTheDocument();
    expect(screen.getByText(/a\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/b\.txt/)).toBeInTheDocument();
  });

  it("keeps uploading remaining files and summarizes partial failures", async () => {
    const onUploadComplete = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const formData = init?.body as FormData;
      const relativePath = String(formData.get("relativePath"));
      if (relativePath.endsWith("bad.txt")) {
        return {
          ok: false,
          json: async () => ({ error: "磁盘空间不足" }),
        } as Response;
      }
      const file = formData.get("file") as File;
      return {
        ok: true,
        json: async () => ({ relativePath, size: file.size }),
      } as Response;
    });

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="docs"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["ok"], "ok.txt"),
          new File(["bad"], "bad.txt"),
          new File(["ok2"], "later.txt"),
        ],
      },
    });

    await waitFor(() =>
      expect(
        screen.getByText("上传完成 2/3 个文件，1 个失败"),
      ).toBeInTheDocument(),
    );
    expect(onUploadComplete).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/bad\.txt/)).toHaveTextContent(
      "失败：磁盘空间不足",
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("allows uploading to SFTP nodes instead of disabling the picker", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const formData = init?.body as FormData;
        return {
          ok: true,
          json: async () => ({
            relativePath: formData.get("relativePath"),
            size: 5,
          }),
        } as Response;
      });

    render(
      <FileUploadDropzone
        nodes={[localNode, sftpNode]}
        initialNodeId="node_sftp"
        initialRelativeDir="remote/uploads"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    expect(screen.getByRole("button", { name: "选择文件" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "选择文件夹" })).toBeEnabled();

    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: {
          files: [new File(["hello"], "remote.txt", { type: "text/plain" })],
        },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get("storageNodeId")).toBe("node_sftp");
    expect(formData.get("relativePath")).toBe("remote/uploads/remote.txt");
    expect(onUploadComplete).toHaveBeenCalledWith({
      relativePath: "remote/uploads/remote.txt",
      size: 5,
    });
  });

  it("uses a controlled upload directory when SPA navigation changes the current folder", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ relativePath: "media/videos/clip.mp4", size: 4 }),
    } as Response);

    const { rerender } = render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        uploadDir="docs"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
      />,
    );

    const pathInput = screen.getByLabelText("上传目录路径");
    expect(pathInput).toHaveValue("docs");

    rerender(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        uploadDir="media/videos"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
      />,
    );

    expect(pathInput).toHaveValue("media/videos");
    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [new File(["clip"], "clip.mp4")] },
      },
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const fetchMock = vi.mocked(globalThis.fetch);
    const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get("relativePath")).toBe("media/videos/clip.mp4");
  });

  it("updates the selected upload node when the current SPA node changes", () => {
    const { rerender } = render(
      <FileUploadDropzone
        nodes={[localNode, sftpNode]}
        initialNodeId="node_local"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
      />,
    );

    expect(screen.getByLabelText("上传到节点")).toHaveValue("node_local");

    rerender(
      <FileUploadDropzone
        nodes={[localNode, sftpNode]}
        initialNodeId="node_sftp"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
      />,
    );

    expect(screen.getByLabelText("上传到节点")).toHaveValue("node_sftp");
  });

  it("rejects unsafe upload directories on the client before sending files", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ relativePath: "ignored.txt", size: 7 }),
    } as Response);

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="../secret"
        title="上传"
        description="上传文件"
        submitLabel="选择文件"
        pathLabel="上传目录路径"
        onUploadComplete={onUploadComplete}
      />,
    );

    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [new File(["secret"], "secret.txt")] },
      },
    );

    await waitFor(() =>
      expect(screen.getByText("路径不能包含 . 或 ..")).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("localizes upload status, validation, and dropzone copy in English", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ relativePath: "docs/report.txt", size: 6 }),
    } as Response);

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="docs"
        title="Upload"
        description="Upload files"
        submitLabel="Select files"
        pathLabel="Upload directory path"
        onUploadComplete={onUploadComplete}
      />,
      { locale: "en" },
    );

    expect(
      screen.getByPlaceholderText("docs or media/videos"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Drag files here or select multiple files; use folder mode below for folders.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select folder" }),
    ).toBeInTheDocument();

    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [new File(["report"], "report.txt")] },
      },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText("Uploaded: docs/report.txt (6 B)"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Completed: docs\/report\.txt/),
    ).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("localizes client-side path validation errors in English", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ relativePath: "ignored.txt", size: 7 }),
    } as Response);

    render(
      <FileUploadDropzone
        nodes={[localNode]}
        initialNodeId="node_local"
        initialRelativeDir="../secret"
        title="Upload"
        description="Upload files"
        submitLabel="Select files"
        pathLabel="Upload directory path"
      />,
      { locale: "en" },
    );

    fireEvent.change(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: { files: [new File(["secret"], "secret.txt")] },
      },
    );

    await waitFor(() =>
      expect(
        screen.getByText("Path cannot contain . or .."),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
