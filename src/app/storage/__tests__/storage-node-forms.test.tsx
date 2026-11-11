import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const actions = vi.hoisted(() => ({ createStorageNodeAction: vi.fn(), updateStorageNodeAction: vi.fn() }));
vi.mock("../actions", () => actions);

import { StorageNodeCreateForm } from "../storage-node-create-form";
import { StorageNodeEditForm } from "../storage-node-edit-form";

const servers = [{ id: "s1", name: "Tokyo", host: "10.0.0.1" }];

async function press(name: string) {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name }));
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("storage node forms", () => {
	beforeEach(() => {
		actions.createStorageNodeAction.mockReset();
		actions.updateStorageNodeAction.mockReset();
	});

	it("keeps a new node as it was typed when it is refused", async () => {
		// React clears the fields of a form whose action has answered, a refusal included: the driver stayed
		// (it is kept in state) and everything typed under it was gone.
		actions.createStorageNodeAction.mockImplementation(async () => ({ error: "无法连接到 sftp.example.com:2200" }));
		renderWithI18n(<StorageNodeCreateForm servers={servers} />);
		fireEvent.change(screen.getByLabelText("驱动"), { target: { value: "SFTP" } });
		fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "素材库" } });
		fireEvent.change(screen.getByLabelText("根目录"), { target: { value: "/data/media" } });
		fireEvent.change(screen.getByLabelText(/远端主机/), { target: { value: "sftp.example.com" } });
		fireEvent.change(screen.getByLabelText("端口"), { target: { value: "2200" } });
		fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "deploy" } });
		await press("创建节点");

		expect(await screen.findByText("无法连接到 sftp.example.com:2200")).toBeInTheDocument();
		expect(screen.getByLabelText("节点名称")).toHaveValue("素材库");
		expect(screen.getByLabelText("根目录")).toHaveValue("/data/media");
		expect(screen.getByLabelText(/远端主机/)).toHaveValue("sftp.example.com");
		expect(screen.getByLabelText("端口")).toHaveValue(2200);
		expect(screen.getByLabelText("用户名")).toHaveValue("deploy");
	});

	it("keeps the edits of a node when they are refused", async () => {
		actions.updateStorageNodeAction.mockImplementation(async () => ({ error: "根路径不可写" }));
		renderWithI18n(<StorageNodeEditForm servers={servers} node={{ id: "node-1", driver: "LOCAL", name: "本地", basePath: "/srv/files", isDefault: false }} />);
		fireEvent.change(screen.getByLabelText("根目录"), { target: { value: "/srv/new" } });
		await press("保存修改");

		expect(await screen.findByText("根路径不可写")).toBeInTheDocument();
		expect(screen.getByLabelText("根目录")).toHaveValue("/srv/new");
	});
});
