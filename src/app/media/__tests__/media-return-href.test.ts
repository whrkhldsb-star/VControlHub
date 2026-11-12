import { describe, expect, it } from "vitest";

import { mediaListFiltersFromHref } from "@/lib/media/service";

import { mediaReturnHref } from "../media-return-href";

/** What the router hands the detail page for `?from=…`: the value, decoded once. */
const received = (detailHref: string) => new URL(detailHref, "http://media.local").searchParams.get("from") ?? undefined;

describe("mediaReturnHref", () => {
	it("returns to the list the item was opened from, filters intact", () => {
		// The page decoded the value a second time: "R&D" became the search "R" plus a parameter "D", and the
		// tag "c++" became "c  ", for the back link and for previous/next alike.
		const list = `/media?${new URLSearchParams({ q: "R&D 100%", tag: "c++", type: "image" })}`;
		const from = received(`/media/item_1?from=${encodeURIComponent(list)}`);
		expect(mediaReturnHref(from)).toBe(list);
		expect(mediaListFiltersFromHref(mediaReturnHref(from))).toEqual({ mediaType: "image", q: "R&D 100%", favorite: undefined, tag: "c++" });
	});

	it("goes to the media list for anything that is not a list address", () => {
		expect(mediaReturnHref(undefined)).toBe("/media");
		expect(mediaReturnHref("")).toBe("/media");
		expect(mediaReturnHref("/media")).toBe("/media");
		expect(mediaReturnHref("/mediax?q=1")).toBe("/media");
		expect(mediaReturnHref("https://elsewhere.example/media?q=1")).toBe("/media");
		expect(mediaReturnHref("//elsewhere.example/media")).toBe("/media");
		// A repeated parameter arrives as a list: the first one counts.
		expect(mediaReturnHref(["/media?type=video", "/media?type=audio"])).toBe("/media?type=video");
		// A value that only looks encoded stays as it is (it is one, and decoding it again threw for "100%").
		expect(mediaReturnHref("/media?q=100%")).toBe("/media?q=100%");
	});
});
