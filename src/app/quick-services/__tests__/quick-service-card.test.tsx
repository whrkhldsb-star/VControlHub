import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

import { ServiceCard } from "../quick-service-card";

const item = {
	slug: "linuxserver-jellyfin", name: "Jellyfin", icon: "📺", image: "lscr.io/linuxserver/jellyfin:latest", description: "Media server",
	category: "media", defaultPort: 8096, port: null, source: "linuxserver", status: "available", stars: 512, monthlyPulls: 3_400_000,
};
const noop = () => undefined;
const card = (overrides: Partial<typeof item> = {}) => (
	<ServiceCard item={{ ...item, ...overrides }} tab="store" busy={false} onInstall={noop} onStart={noop} onStop={noop} onUpdate={noop} onSync={noop} onUninstall={noop} accessHost="" />
);

describe("ServiceCard popularity", () => {
	it("words monthly pulls as a readable number in the page's language", () => {
		// It divided by a thousand and wrote "k" after it: "3400k 次拉取", and "0k" for anything under five hundred.
		const zh = renderWithI18n(card());
		expect(screen.getByText("每月 340万 次拉取")).toBeInTheDocument();
		expect(screen.getByText("⭐ 512")).toBeInTheDocument();
		zh.unmount();
		const small = renderWithI18n(card({ monthlyPulls: 320 }));
		expect(screen.getByText("每月 320 次拉取")).toBeInTheDocument();
		small.unmount();
		renderWithI18n(card(), { locale: "en" });
		expect(screen.getByText("3.4M pulls a month")).toBeInTheDocument();
	});
});
