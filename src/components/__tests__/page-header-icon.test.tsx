import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/servers" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { PageHeaderIcon } from "../page-header-icon";

describe("PageHeaderIcon", () => {
	beforeEach(() => {
		navigation.pathname = "/servers";
	});

	it("shows the navigation glyph of the page, also on its sub-pages", () => {
		const servers = render(<PageHeaderIcon />);
		const tile = servers.container.querySelector("[data-page-icon]");
		expect(tile).not.toBeNull();
		expect(tile?.getAttribute("aria-hidden")).toBe("true");
		expect(tile?.querySelector("svg")).not.toBeNull();
		const serversGlyph = tile?.innerHTML;
		servers.unmount();

		navigation.pathname = "/servers/srv_1/remote-desktop";
		const detail = render(<PageHeaderIcon />);
		expect(detail.container.querySelector("[data-page-icon]")?.innerHTML).toBe(serversGlyph);
	});

	it("covers the account pages and leaves pages outside the console bare", () => {
		navigation.pathname = "/account/security";
		expect(render(<PageHeaderIcon />).container.querySelector("[data-page-icon] svg")).not.toBeNull();
		navigation.pathname = "/share/abc123";
		expect(render(<PageHeaderIcon />).container.querySelector("[data-page-icon]")).toBeNull();
		navigation.pathname = null;
		expect(render(<PageHeaderIcon />).container.querySelector("[data-page-icon]")).toBeNull();
	});
});
