import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import type { AlertRule } from "../alert-rule-types";
import { DeleteRuleDialog } from "../delete-rule-dialog";

describe("DeleteRuleDialog", () => {
	it("shows the rule's name as it is written", () => {
		// The name was put in with String.replace, which reads "$&", "$'" and "$$" in it as instructions:
		// "cpu $& load" was shown as "cpu {name} load".
		const rule = { id: "r1", name: "cpu $& load $' x $$" } as AlertRule;
		render(<DeleteRuleDialog rulePendingDelete={rule} busyAction={null} setRulePendingDelete={vi.fn()} deleteRule={vi.fn()} />);
		expect(screen.getByRole("dialog", { name: "删除告警规则" })).toHaveTextContent("确认删除告警规则 cpu $& load $' x $$？此操作不可恢复。");
	});
});
