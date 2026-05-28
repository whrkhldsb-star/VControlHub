import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowserSpa } from "../files-browser-spa";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/storage/file-upload-dropzone", () => ({
  FileUploadDropzone: (props: { nodes?: Array<{ id: string; driver: string }>; initialNodeId?: string; onUploadComplete?: () => void }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onUploadComplete?.(),
        "data-upload-node-count": props.nodes?.length ?? 0,
        "data-initial-node-id": props.initialNodeId ?? "",
      },
      "模拟上传完成",
    ),
}));

vi.mock("../search-scope-toggle", () => ({
  SearchScopeToggle: () => React.createElement("span", null, "搜索范围"),
}));

vi.mock("../create-folder-form", () => ({
  CreateFolderForm: () => React.createElement("button", { type: "button" }, "新建文件夹"),
}));

vi.mock("../recycle-bin-section-client", () => ({
  RecycleBinSectionClient: () => React.createElement("div", null, "回收站"),
}));

vi.mock("../file-list-client", () => ({
  FileListClient: (props: { files: Array<{ name: string }> }) =>
    React.createElement(
      "div",
      { "data-testid": "file-list" },
      props.files.map((file) => React.createElement("span", { key: file.name }, file.name)),
    ),
}));

const baseData = {
  currentPath: "photos",
  nodeIdFilter: "node_1",
  folders: [],
  files: [
    {
      id: "file_1",
      name: "before.jpg",
      entryType: "FILE",
      mimeType: "image/jpeg",
      relativePath: "photos/before.jpg",
      sizeLabel: "10 KB",
      previewable: true,
      directAccessMode: "managed-download",
      directAccessHref: "/api/storage/local?path=photos%2Fbefore.jpg",
      directAccessDescription: "受控下载",
      storageNodeId: "node_1",
      storageNodeName: "本机存储",
      storageNodeDriver: "LOCAL",
      updatedAt: "2026-05-04T00:00:00.000Z",
    },
  ],
  tree: { name: "root", path: "", children: [] },
  stats: {
    totalNodes: 1,
    defaultNodeName: "本机存储",
    localNodeCount: 1,
    sftpNodeCount: 0,
    totalEntries: 1,
    previewableEntries: 1,
    deletedEntries: 0,
    remoteDirectoryCount: 0,
    totalItems: 1,
  },
  sourceSummary: ["本机存储"],
  searchQuery: "",
  searchScope: "current" as const,
  permissions: {
    canEditLocalFiles: true,
    canDelete: true,
    canManageNodes: true,
  },
  nodes: [{ id: "node_1", name: "本机存储", driver: "LOCAL" }],
};

describe("FilesBrowserSpa", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...baseData,
          files: [
            {
              ...baseData.files[0],
              id: "file_2",
              name: "after.jpg",
              relativePath: "photos/after.jpg",
            },
          ],
        }),
      }),
    );
  });

	it("refreshes the SPA file list after upload completes", async () => {
		render(<FilesBrowserSpa initialData={baseData} deletedEntries={[]} sftpNodes={[]} />);

		expect(screen.getByText("before.jpg")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "模拟上传完成" }));

		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/list?path=photos&nodeId=node_1", expect.any(Object)));
		await waitFor(() => expect(screen.getByText("after.jpg")).toBeInTheDocument());
	});

	it("surfaces list refresh failures inline and keeps the previous file list visible", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("文件列表刷新失败"));

		render(<FilesBrowserSpa initialData={baseData} deletedEntries={[]} sftpNodes={[]} />);
		expect(screen.getByText("before.jpg")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "模拟上传完成" }));

		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("文件列表刷新失败"));
		expect(screen.getByText("before.jpg")).toBeInTheDocument();
	});

	it("filters storage nodes before switching the file browser node", async () => {
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				...baseData,
				nodeIdFilter: "node_sftp_2",
				currentPath: "",
				files: [],
				nodes: [
					{ id: "node_1", name: "本机存储", driver: "LOCAL" },
					{ id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
					{ id: "node_sftp_2", name: "东京归档", driver: "SFTP" },
				],
			}),
		} as Response);
		render(
			<FilesBrowserSpa
				initialData={{
					...baseData,
					nodes: [
						{ id: "node_1", name: "本机存储", driver: "LOCAL" },
						{ id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
						{ id: "node_sftp_2", name: "东京归档", driver: "SFTP" },
					],
				}}
				deletedEntries={[]}
				sftpNodes={[]}
			/>,
		);

		const sidebarSearch = screen.getAllByPlaceholderText("搜索节点名称、类型或 ID")[0];
		const sidebarSelect = screen.getAllByLabelText("选择存储节点")[0];
		fireEvent.change(sidebarSearch, { target: { value: "东京" } });
		expect(within(sidebarSelect).getByRole("option", { name: /东京归档/ })).toBeInTheDocument();
		expect(within(sidebarSelect).queryByRole("option", { name: /香港 VPS/ })).not.toBeInTheDocument();

		fireEvent.change(sidebarSelect, { target: { value: "node_sftp_2" } });

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/files/list?nodeId=node_sftp_2", expect.any(Object)));
	});
});
