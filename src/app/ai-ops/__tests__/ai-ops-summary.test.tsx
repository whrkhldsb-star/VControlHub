import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { useI18n } from "@/lib/i18n/use-locale";
import type { AiOpsSummary } from "@/lib/ai/ops/service";

import { AiOpsSummarySection } from "../ai-ops-sections";

function Summary({ summary }: { summary: AiOpsSummary }) {
	const { t } = useI18n();
	return <AiOpsSummarySection t={t} summary={summary} />;
}

/** Every scan status keeps a count in the summary, not only the three with cards. */
describe("AiOpsSummarySection", () => {
	it("counts running and skipped scans", () => {
		render(
			<Summary
				summary={{
					total: 9,
					byStatus: { ok: 2, warning: 1, error: 1, skipped: 3, running: 2 },
					byMode: { recommendation: 9, autonomous: 0 },
					lastScanAt: null,
					lastErrorAt: null,
				}}
			/>,
		);
		const summary = screen.getByLabelText("ai-ops-summary");
		expect(summary).toHaveTextContent("运行中 2");
		expect(summary).toHaveTextContent("已跳过 3");
	});
});
