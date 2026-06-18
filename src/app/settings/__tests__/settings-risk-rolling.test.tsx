/**
 * TR-014 M01a: FieldDef 风险等级 + rollbackable + 字段级恢复默认.
 *
 * 重点：
 *  - riskLevel: low 不渲染 badge, medium/high 渲染 + role="img" via aria-label
 *  - rollbackable: 推断 (有 defaultValue 且非 password) + 显式 false 关闭
 *  - 恢复默认按钮: 当前已是 defaultValue 时禁用, 避免无操作
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { FieldRiskBadge, FieldRollbackButton } from "@/app/settings/settings-client";
import { SETTINGS_SCHEMA, type FieldDef } from "@/app/settings/field-schema";

describe("FieldRiskBadge", () => {
  it("returns null for undefined or low", () => {
    const { container: c1 } = render(<FieldRiskBadge level={undefined} />);
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<FieldRiskBadge level="low" />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders medium badge with amber tone and data-risk='medium'", () => {
    render(<FieldRiskBadge level="medium" />);
    const badge = screen.getByLabelText("中风险");
    expect(badge.getAttribute("data-risk")).toBe("medium");
    expect(badge.className).toContain("amber-400");
  });

  it("renders high badge with rose tone and data-risk='high'", () => {
    render(<FieldRiskBadge level="high" />);
    const badge = screen.getByLabelText("高风险");
    expect(badge.getAttribute("data-risk")).toBe("high");
    expect(badge.className).toContain("rose-400");
  });

  it("includes a sr-only text so screen readers read '高风险' / '中风险'", () => {
    const { rerender } = render(<FieldRiskBadge level="high" />);
    expect(screen.getByText("高风险")).toBeInTheDocument();
    rerender(<FieldRiskBadge level="medium" />);
    expect(screen.getByText("中风险")).toBeInTheDocument();
  });
});

describe("FieldRollbackButton", () => {
  function makeField(overrides: Partial<FieldDef> = {}): FieldDef {
    return {
      key: "test.field",
      label: "测试字段",
      type: "text",
      defaultValue: "默认值",
      ...overrides,
    };
  }

  it("renders for fields with defaultValue (non-password)", () => {
    render(<FieldRollbackButton field={makeField()} value="改过的值" onChange={() => {}} disabled={false} />);
    expect(screen.getByRole("button", { name: /恢复 测试字段 到默认值/ })).toBeInTheDocument();
  });

  it("does NOT render for password fields by default", () => {
    render(
      <FieldRollbackButton
        field={makeField({ type: "password" })}
        value="secret"
        onChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
  });

  it("does NOT render when field.rollbackable=false even with defaultValue", () => {
    render(
      <FieldRollbackButton
        field={makeField({ rollbackable: false })}
        value="改过的值"
        onChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
  });

  it("does NOT render when field.defaultValue is undefined", () => {
    render(
      <FieldRollbackButton
        field={makeField({ defaultValue: undefined })}
        value=""
        onChange={() => {}}
        disabled={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /恢复/ })).toBeNull();
  });

  it("is disabled when value already equals defaultValue", () => {
    render(
      <FieldRollbackButton
        field={makeField()}
        value="默认值"
        onChange={() => {}}
        disabled={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /恢复/ });
    expect(btn).toBeDisabled();
  });

  it("is disabled when value is empty (treats empty as 'no value yet')", () => {
    render(
      <FieldRollbackButton
        field={makeField()}
        value=""
        onChange={() => {}}
        disabled={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /恢复/ });
    expect(btn).toBeDisabled();
  });

  it("calls onChange with defaultValue when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldRollbackButton
        field={makeField({ defaultValue: "原始默认" })}
        value="被改过"
        onChange={onChange}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /恢复/ }));
    expect(onChange).toHaveBeenCalledWith("原始默认");
  });

  it("respects the parent disabled prop", () => {
    render(
      <FieldRollbackButton
        field={makeField()}
        value="different"
        onChange={() => {}}
        disabled={true}
      />,
    );
    expect(screen.getByRole("button", { name: /恢复/ })).toBeDisabled();
  });
});

describe("SETTINGS_SCHEMA risk classification (TR-014 schema audit)", () => {
	it("marks exactly the documented high-risk fields", () => {
		const expectedHigh = new Set([
			"session.timeout",
			"password.minLength",
			"smtp.pass",
			"runtime.commandExecutionTimeoutMs",
			"runtime.commandStaleRunningAfterMs",
			"runtime.sshIdleTimeoutSec",
			// TR-007 M03: 异地备份的 accessKeyId / secretAccessKey 改错会导致推送失败
			"offsite.accessKeyId",
			"offsite.secretAccessKey",
			// TR-032 E02: ai.ops.mode 切到 autonomous 后 AI 会自动执行白名单内的安全动作, 风险高
			"ai.ops.mode",
			// TR-009 55d: Telegram Bot Token 错会让所有 Telegram 告警失败; 改后无法立即验证
			"telegram.botToken",
			]);
		const allHigh: string[] = [];
		for (const section of SETTINGS_SCHEMA) {
			for (const field of section.fields) {
				if (field.riskLevel === "high") allHigh.push(field.key);
			}
		}
		expect(new Set(allHigh)).toEqual(expectedHigh);
	});

  it("marks all password.requireXxx switches as medium risk", () => {
    for (const section of SETTINGS_SCHEMA) {
      for (const field of section.fields) {
        if (field.key.startsWith("password.require")) {
          expect(field.riskLevel, `${field.key} should be medium`).toBe("medium");
        }
      }
    }
  });

  it("every runtime.* field has a risk level (low/medium/high)", () => {
    for (const section of SETTINGS_SCHEMA) {
      for (const field of section.fields) {
        if (field.key.startsWith("runtime.")) {
          expect(field.riskLevel, `${field.key} missing riskLevel`).toBeDefined();
          expect(["low", "medium", "high"]).toContain(field.riskLevel);
        }
      }
    }
  });
});
