import { describe, expect, it } from "vitest";

import { rebaseDescendantPath } from "../rebase-path";

describe("rebaseDescendantPath", () => {
	it("swaps the directory prefix and keeps the rest", () => {
		expect(rebaseDescendantPath("a/b/c.txt", "a/b/", "x/y/")).toBe("x/y/c.txt");
		expect(rebaseDescendantPath("a/b/c/d.txt", "a/b/", "x/")).toBe("x/c/d.txt");
	});

	it("takes replacement patterns in the new name literally", () => {
		// "a/".replace("a/", "x$$/") gave "x$/", "$&" gave the old prefix: the moved files were indexed under other names.
		expect(rebaseDescendantPath("a/b.txt", "a/", "Cash$$/")).toBe("Cash$$/b.txt");
		expect(rebaseDescendantPath("a/b.txt", "a/", "x$&y/")).toBe("x$&y/b.txt");
		expect(rebaseDescendantPath("a/b.txt", "a/", "p$`q/")).toBe("p$`q/b.txt");
		expect(rebaseDescendantPath("a/b.txt", "a/", "p$'q/")).toBe("p$'q/b.txt");
	});

	it("leaves a path that is not below the prefix alone", () => {
		expect(rebaseDescendantPath("other/b.txt", "a/", "x/")).toBe("other/b.txt");
	});
});
