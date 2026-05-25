import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
	createSshKeyAction: vi.fn(),
}));

import { SshKeyCreateForm } from "../ssh-key-create-form";

describe("SshKeyCreateForm", () => {
	it("shows the selected PPK filename after upload", async () => {
		const user = userEvent.setup();
		render(<SshKeyCreateForm />);

		// The file input is hidden inside a label; find it by name
		const input = document.querySelector('input[name="ppkFile"]') as HTMLInputElement;
		const file = new File(["ppk-content"], "prod-root-key.ppk", { type: "application/octet-stream" });

		await user.upload(input, file);

		expect(input.files?.[0]?.name).toBe("prod-root-key.ppk");
		// After upload, the label text changes to the filename
		expect(screen.getByText("prod-root-key.ppk")).toBeInTheDocument();
	});

	it("allows importing a PPK file without requiring a pasted private key", () => {
		render(<SshKeyCreateForm />);

		expect(screen.getByLabelText("私钥")).not.toBeRequired();
		expect(screen.getByText("PuTTY .ppk 上传")).toBeInTheDocument();
	});
});
