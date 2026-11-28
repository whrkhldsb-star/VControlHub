import { useRef, useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { api } from "@/lib/http/api-client";
import { SessionGateProvider } from "@/lib/auth/session-context";
import { EditorSnippetPicker, SnippetPicker } from "../snippet-picker";
import { SshTerminalSidePanel } from "../ssh-terminal-side-panel";
import { useI18n } from "@/lib/i18n/use-locale";

vi.mock("@/lib/http/api-client", () => ({ api: { get: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockReset(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Insert snippet" }));
it("only sends the reviewed SSH draft after an explicit terminal action", async () => {
	vi.mocked(api.get).mockResolvedValue({ snippets: [] });
	const sendCommand = vi.fn(), sendKeys = vi.fn();
	function Panel() {
		const { t } = useI18n();
		return <SshTerminalSidePanel serverId="node" t={t} favoriteCommands={[]} newFavorite="" setNewFavorite={vi.fn()} addFavorite={vi.fn()} removeFavorite={vi.fn()}
			commandHistory={[]} onClearHistory={vi.fn()} sendCommand={sendCommand} sendKeys={sendKeys} onAddQuickKey={vi.fn()} onResetQuickKeys={vi.fn()} fontSize={14}
			onFontSizeChange={vi.fn()} keepAlive={false} keepAliveMinutes={null} onKeepAliveChange={vi.fn()} />;
	}
	renderWithI18n(<Panel />, { locale: "en" });
	fireEvent.click(screen.getByText("Local command draft")); open(); fireEvent.click(screen.getByText("Inspect system resources"));
	const draft = screen.getByLabelText<HTMLTextAreaElement>("Review the command before sending");
	expect(draft.value).toContain("uptime"); expect(sendCommand).not.toHaveBeenCalled(); expect(sendKeys).not.toHaveBeenCalled();
	fireEvent.change(draft, { target: { value: "uptime" } }); fireEvent.click(screen.getByRole("button", { name: "Send to terminal" }));
	expect(sendCommand).toHaveBeenCalledExactlyOnceWith("uptime"); expect(draft.value).toBe("");
	fireEvent.change(draft, { target: { value: "whoami" } }); fireEvent.keyDown(draft, { key: "Enter", ctrlKey: true });
	expect(sendCommand).toHaveBeenLastCalledWith("whoami");
});
it.each(["template", "immediate"] as const)("handles keyboard search and variables in %s mode without saved-snippet permission", mode => {
	const insert = vi.fn();
	renderWithI18n(<SnippetPicker mode={mode} canReadSavedSnippets={false} onInsert={insert} />, { locale: "en" });
	open();
	const search = screen.getByRole("combobox", { name: "Search snippets" });
	fireEvent.keyDown(search, { key: "ArrowDown" }); expect(screen.getAllByRole("option", { selected: true }).some(row => row.textContent?.includes("systemd"))).toBe(true);
	fireEvent.keyDown(search, { key: "ArrowUp" });
	fireEvent.change(search, { target: { value: "systemctl status" } });
	fireEvent.keyDown(search, { key: "Enter" });
	if (mode === "immediate") {
		expect(insert).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText("service"), { target: { value: "nginx" } });
		fireEvent.click(screen.getByRole("button", { name: "Apply variables and insert" }));
	}
	expect(insert).toHaveBeenCalledWith(`systemctl status ${mode === "immediate" ? "nginx" : "{{service}}"} --no-pager -l`, "insert");
	expect(api.get).not.toHaveBeenCalled();
});
it("keeps starters usable when the lazily fetched saved list returns 403", async () => {
	vi.mocked(api.get).mockRejectedValue({ status: 403 });
	renderWithI18n(<SnippetPicker mode="template" onInsert={vi.fn()} />, { locale: "en" });
	expect(api.get).not.toHaveBeenCalled(); open(); await waitFor(() => expect(api.get).toHaveBeenCalled());
	expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Inspect Windows volumes")).toBeVisible();
	fireEvent.keyDown(screen.getByRole("combobox", { name: "Search snippets" }), { key: "Escape" }); expect(screen.queryByRole("listbox")).toBeNull();
});
it("refuses an overflowing insertion, then replaces only the selected range with the full saved body", async () => {
	const row = { id: "saved", title: "Saved body", tags: [], language: "bash", contentPreview: "ec…" };
	const content = "echo hello";
	vi.mocked(api.get).mockImplementation(async url => url.includes("?id=") ? { snippet: { content } } : { snippets: [row] });
	function Editor() {
		const editor = useRef<HTMLTextAreaElement>(null); const [text, setText] = useState("x".repeat(10_000));
		return <><textarea ref={editor} aria-label="Buffer" value={text} onChange={e => setText(e.target.value)} /><EditorSnippetPicker mode="immediate" editor={editor} onChange={setText} /></>;
	}
	renderWithI18n(<Editor />, { locale: "en" });
	const buffer = screen.getByLabelText<HTMLTextAreaElement>("Buffer"); buffer.setSelectionRange(1, 1);
	open(); fireEvent.click(await screen.findByText("Saved body"));
	expect(await screen.findByRole("alert")).toHaveTextContent("10,000"); expect(buffer.value).toBe("x".repeat(10_000));
	buffer.setSelectionRange(1, 11); fireEvent.click(screen.getByText("Saved body"));
	await waitFor(() => expect(buffer.value).toBe(`x${content}${"x".repeat(9989)}`));
	open(); fireEvent.change(screen.getByLabelText("Insertion mode"), { target: { value: "replace" } });
	fireEvent.click(await screen.findByText("Saved body")); await waitFor(() => expect(buffer.value).toBe(content));
});

it("keeps the SSH draft intact when send fails or terminal is disconnected (Carbon P1-4)", () => {
	vi.mocked(api.get).mockResolvedValue({ snippets: [] });
	const sendCommand = vi.fn().mockReturnValue(false);
	function Panel({ connected }: { connected: boolean }) {
		const { t } = useI18n();
		return <SshTerminalSidePanel serverId="node" connected={connected} t={t} favoriteCommands={[]} newFavorite="" setNewFavorite={vi.fn()} addFavorite={vi.fn()} removeFavorite={vi.fn()}
			commandHistory={[]} onClearHistory={vi.fn()} sendCommand={sendCommand} sendKeys={vi.fn()} onAddQuickKey={vi.fn()} onResetQuickKeys={vi.fn()} fontSize={14}
			onFontSizeChange={vi.fn()} keepAlive={false} keepAliveMinutes={null} onKeepAliveChange={vi.fn()} />;
	}
	const { rerender } = renderWithI18n(<Panel connected={true} />, { locale: "en" });
	fireEvent.click(screen.getByText("Local command draft"));
	const draft = screen.getByLabelText<HTMLTextAreaElement>("Review the command before sending");
	fireEvent.change(draft, { target: { value: "df -h" } });
	fireEvent.click(screen.getByRole("button", { name: "Send to terminal" }));
	expect(sendCommand).toHaveBeenCalledWith("df -h");
	expect(draft.value).toBe("df -h");

	rerender(<Panel connected={false} />);
	expect(screen.getByRole("button", { name: "Send to terminal" })).toBeDisabled();
});

it("skips saved-snippet API fetches when authenticated session lacks snippet:manage (Carbon P2-2)", () => {
	renderWithI18n(
		<SessionGateProvider value={{ authenticated: true, roles: [], permissions: ["command:create"] }}>
			<SnippetPicker mode="template" onInsert={vi.fn()} />
		</SessionGateProvider>,
		{ locale: "en" },
	);
	open();
	expect(api.get).not.toHaveBeenCalled();
	expect(screen.getByText("Inspect system resources")).toBeVisible();
});
