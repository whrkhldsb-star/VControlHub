// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { AiSettingsModelSelector } from "../ai-settings-model-selector";
import type { SettingsFormState } from "../ai-settings-types";
import type { ModelInfo } from "../ai-types";

/**
 * The model list had two text fields bound to one text: "search" at the top and "enter a model id" at the
 * bottom, so typing in either filled both. It closed only by picking a model or pressing the button again:
 * a click anywhere else, or Escape, left it open over the settings below it.
 */
const MODELS: ModelInfo[] = [
	{ id: "gpt-4o", name: "gpt-4o", vision: true },
	{ id: "gpt-4o-mini", name: "gpt-4o-mini", vision: true },
	{ id: "deepseek-chat", name: "deepseek-chat", vision: false },
];

function Harness({ models = MODELS }: { models?: ModelInfo[] }) {
	const [form, setForm] = useState({ model: "gpt-4o", enableVision: true } as SettingsFormState);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	return (
		<>
			<AiSettingsModelSelector
				settingsForm={form}
				setSettingsForm={setForm}
				modelList={models}
				modelsLoading={false}
				modelDropdownOpen={open}
				setModelDropdownOpen={setOpen}
				modelSearch={search}
				setModelSearch={setSearch}
				currentModelSupportsVision={false}
				onRefreshModels={() => {}}
			/>
			<output data-testid="model">{form.model}</output>
			<output data-testid="vision">{String(form.enableVision)}</output>
			<button type="button">elsewhere</button>
		</>
	);
}

const trigger = () => screen.getByRole("button", { name: /^模型/ });
const openList = () => fireEvent.click(trigger());
const field = () => screen.getByRole("textbox", { name: "搜索模型，或输入模型 ID" }) as HTMLInputElement;
const model = () => screen.getByTestId("model").textContent;

describe("AiSettingsModelSelector", () => {
	it("names the button by the setting and the model in effect", () => {
		render(<Harness />);
		expect(trigger()).toHaveAccessibleName("模型 gpt-4o");
		expect(trigger()).toHaveAttribute("aria-expanded", "false");
	});

	it("has one field, which narrows the list", () => {
		render(<Harness />);
		openList();
		expect(screen.getAllByRole("textbox")).toHaveLength(1);
		fireEvent.change(field(), { target: { value: "deep" } });
		expect(screen.getByRole("button", { name: /deepseek-chat/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /gpt-4o-mini/ })).not.toBeInTheDocument();
	});

	it("offers an id that is not in the list as typed", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: " my-local-model " } });
		expect(screen.getByText("没有匹配的模型")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "使用「my-local-model」" }));
		expect(model()).toBe("my-local-model");
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("does not offer an id the list already has", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "gpt-4o" } });
		expect(screen.queryByRole("button", { name: /^使用「/ })).not.toBeInTheDocument();
	});

	it("takes the only match on Enter, and its image support with it", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "deep" } });
		fireEvent.keyDown(field(), { key: "Enter" });
		expect(model()).toBe("deepseek-chat");
		expect(screen.getByTestId("vision").textContent).toBe("false");
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("takes the id typed in full on Enter although other ids contain it", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "gpt-4o-mini" } });
		fireEvent.keyDown(field(), { key: "Enter" });
		expect(model()).toBe("gpt-4o-mini");
	});

	it("chooses nothing on Enter while several models match", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "gpt" } });
		fireEvent.keyDown(field(), { key: "Enter" });
		expect(model()).toBe("gpt-4o");
		expect(field()).toBeInTheDocument();
	});

	it("uses the id as typed on Enter when no model matches", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "qwen-max" } });
		fireEvent.keyDown(field(), { key: "Enter" });
		expect(model()).toBe("qwen-max");
	});

	it("closes on a press elsewhere and forgets the search", () => {
		render(<Harness />);
		openList();
		fireEvent.change(field(), { target: { value: "deep" } });
		fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(model()).toBe("gpt-4o");
		openList();
		expect(field().value).toBe("");
	});

	it("closes on Escape and puts the focus back on its button", () => {
		render(<Harness />);
		openList();
		fireEvent.keyDown(field(), { key: "Escape" });
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(trigger()).toHaveFocus();
	});

	it("tells an empty list from a search without a match", () => {
		render(<Harness models={[]} />);
		openList();
		const panel = field().closest("[data-popover]") as HTMLElement;
		expect(within(panel).getByText("无可用模型")).toBeInTheDocument();
		expect(within(panel).getByRole("button", { name: "刷新" })).toBeInTheDocument();
		expect(within(panel).queryByText("没有匹配的模型")).not.toBeInTheDocument();
	});
});
