/**
 * scripts/__tests__/accessibility-audit.test.ts
 *
 * Unit tests for the accessibility audit parser. These tests focus on the
 * pure-function parser (scanFile, auditFiles) so the script can be tested
 * without touching the filesystem.
 *
 * The audit's job: for every user-facing form field (input / textarea /
 * select) in a TSX file, decide whether it has a visible label association
 * (htmlFor, aria-label, aria-labelledby, or wrapped inside a <label>).
 */
import { describe, expect, it } from "vitest";

import {
  scanFile,
  auditFiles,
  scanIconOnlyButtons,
  auditIconOnlyButtons,
  type FieldResult,
} from "../accessibility-audit";

describe("scanFile — basic positive cases", () => {
  it("passes an input that has a matching <label htmlFor>", () => {
    const text = `
      <label htmlFor="username-input">Username</label>
      <input id="username-input" name="username" type="text" />
    `;
    const results = scanFile("login.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.reason).toBe("htmlFor-match");
    expect(results[0]!.matchedLabelLine).toBe(2);
    expect(results[0]!.field.id).toBe("username-input");
    expect(results[0]!.field.type).toBe("text");
  });

  it("passes an input that has aria-label", () => {
    const text = `
      <input type="search" aria-label="Search tickets" placeholder="Type to search" />
    `;
    const results = scanFile("tickets.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.reason).toBe("aria-label");
    expect(results[0]!.field.ariaLabel).toBe("Search tickets");
  });

  it("passes an input that has aria-labelledby pointing to an in-file id", () => {
    const text = `
      <h2 id="search-heading">Search</h2>
      <input type="search" aria-labelledby="search-heading" />
    `;
    const results = scanFile("search.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.reason).toBe("aria-labelledby");
  });

  it("passes an input that is wrapped inside a <label>", () => {
    const text = `
      <label className="flex gap-2">
        <input type="checkbox" />
        Remember me
      </label>
    `;
    const results = scanFile("login.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.reason).toBe("label-wrapped");
  });
});

describe("scanFile — negative / flag cases", () => {
  it("flags an input with no label, no aria, and no wrap", () => {
    const text = `
      <input type="search" placeholder="Search logs" />
    `;
    const results = scanFile("audit.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.reason).toBe("no-label");
  });

  it("flags a textarea with no label and no aria", () => {
    const text = `
      <textarea placeholder="Add a comment..." rows={3} />
    `;
    const results = scanFile("tickets.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.field.kind).toBe("textarea");
  });

  it("flags a select with only placeholder guidance", () => {
    const text = `
      <select name="priority">
        <option value="low">Low</option>
      </select>
    `;
    const results = scanFile("tickets.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.field.kind).toBe("select");
  });

  it("flags an input that has id but no matching <label htmlFor> in file", () => {
    const text = `
      <input id="orphan" type="text" />
      <label htmlFor="different">Other</label>
    `;
    const results = scanFile("orphan.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.field.id).toBe("orphan");
  });

  it("flags an input whose aria-labelledby points to a missing id", () => {
    const text = `
      <input type="search" aria-labelledby="not-in-file" />
    `;
    const results = scanFile("broken.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.field.ariaLabelledBy).toBe("not-in-file");
  });
});

describe("scanFile — skip rules", () => {
	it("skips field-like markup inside comments", () => {
		expect(scanFile("comment.tsx", `// previously rendered <select>\n/* <input /> */`)).toHaveLength(0);
	});

	it("skips reusable primitives that forward their accessibility props", () => {
		expect(scanFile("input.tsx", `<input className={className} {...rest} />`)).toHaveLength(0);
	});

  it("skips type=hidden inputs entirely", () => {
    const text = `
      <form>
        <input type="hidden" name="csrf" value="x" />
        <input type="text" name="q" />
      </form>
    `;
    const results = scanFile("form.tsx", text);
    // The visible input is unlabeled → flag; the hidden one is skipped
    expect(results).toHaveLength(1);
    expect(results[0]!.field.type).toBe("text");
    expect(results[0]!.ok).toBe(false);
  });

  it("skips type=submit / type=button / type=reset / type=image inputs", () => {
    const text = `
      <input type="submit" value="Save" />
      <input type="button" value="Cancel" />
      <input type="reset" />
      <input type="image" src="x.png" />
    `;
    const results = scanFile("buttons.tsx", text);
    expect(results).toHaveLength(0);
  });
});

describe("scanFile — multi-file aggregation via auditFiles", () => {
  it("groups flagged fields by file and counts ok vs flagged totals", () => {
    const files = [
      {
        path: "a.tsx",
        text: `
          <label htmlFor="x">X</label>
          <input id="x" type="text" />
          <input type="text" placeholder="Unlabeled" />
        `,
      },
      {
        path: "b.tsx",
        text: `
          <input type="search" aria-label="Find" />
          <textarea rows={2} />
        `,
      },
    ];
    const summary = auditFiles(files);
    expect(summary.total).toBe(4);
    expect(summary.ok).toBe(2);
    expect(summary.flagged).toBe(2);
    expect(summary.byFile["a.tsx"]).toHaveLength(2);
    expect(summary.byFile["b.tsx"]).toHaveLength(2);
    const aFlagged = summary.byFile["a.tsx"]!.filter((r) => !r.ok);
    expect(aFlagged).toHaveLength(1);
    const bFlagged = summary.byFile["b.tsx"]!.filter((r) => !r.ok);
    expect(bFlagged).toHaveLength(1);
    expect(bFlagged[0]!.field.kind).toBe("textarea");
  });
});

describe("scanFile — JSX / TypeScript quirks", () => {
  it("extracts attributes from a multi-line input tag", () => {
    const text = `
      <input
        id="server-name"
        name="name"
        type="text"
        required
        placeholder="prod-1"
      />
      <label htmlFor="server-name">Node name</label>
    `;
    const results = scanFile("server.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.field.id).toBe("server-name");
    expect(results[0]!.field.placeholder).toBe("prod-1");
  });

  it("extracts attributes from a self-closing multi-line input", () => {
    const text = `
      <input
        type="text"
        aria-label="Search"
        defaultValue=""
      />
    `;
    const results = scanFile("self-close.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.field.ariaLabel).toBe("Search");
  });

  it("does not match '>' inside a JSX expression as the tag close", () => {
    const text = `
      <input
        type="text"
        aria-label={value > 5 ? "big" : "small"}
        placeholder="x"
      />
    `;
    const results = scanFile("expr.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.field.ariaLabel).toBeTruthy();
  });

  it("returns a useful line number for the field and matched label", () => {
    const text = `line1
line2
<label htmlFor="user">User</label>
line4
<input id="user" type="text" />`;
    const results = scanFile("lines.tsx", text);
    expect(results).toHaveLength(1);
    expect(results[0]!.field.line).toBe(5);
    expect(results[0]!.matchedLabelLine).toBe(3);
  });
});

describe("scanFile — Field shape sanity", () => {
  it("preserves kind / id / type / name / placeholder / ariaLabel", () => {
    const text = `
      <input
        id="email-input"
        name="email"
        type="email"
        placeholder="you@example.com"
        aria-label="Email address"
      />
    `;
    const results = scanFile("form.tsx", text);
    expect(results).toHaveLength(1);
    const f = results[0]!.field;
    expect(f.kind).toBe("input");
    expect(f.id).toBe("email-input");
    expect(f.type).toBe("email");
    expect(f.name).toBe("email");
    expect(f.placeholder).toBe("you@example.com");
    expect(f.ariaLabel).toBe("Email address");
  });
});

describe("auditFiles — empty input", () => {
  it("returns zero totals on an empty file list", () => {
    const summary = auditFiles([]);
    expect(summary.total).toBe(0);
    expect(summary.ok).toBe(0);
    expect(summary.flagged).toBe(0);
    expect(Object.keys(summary.byFile)).toHaveLength(0);
  });

  it("returns zero totals when a file has no fields at all", () => {
    const summary = auditFiles([{ path: "empty.tsx", text: "export const x = 1;\n" }]);
    expect(summary.total).toBe(0);
    expect(summary.flagged).toBe(0);
  });
});

describe("scanFile — FieldResult discriminants", () => {
  it("emits one FieldResult per scanned field", () => {
    const text = `
      <label htmlFor="a">A</label>
      <input id="a" type="text" />
      <label htmlFor="b">B</label>
      <input id="b" type="text" />
    `;
    const results: FieldResult[] = scanFile("two.tsx", text);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok && r.reason === "htmlFor-match")).toBe(true);
  });
});

describe("scanIconOnlyButtons — basic positive cases (button is labeled)", () => {
  it("passes a button with visible text inside", () => {
    const text = `<button>Save</button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });

  it("passes a button with aria-label", () => {
    const text = `<button aria-label="Close menu"><svg /></button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });

  it("passes a button with aria-labelledby", () => {
    const text = `<button aria-labelledby="x"><svg /></button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });

  it("passes a button with title (acceptable fallback)", () => {
    const text = `<button title="Refresh"><svg /></button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });

  it("passes a button whose text is in a JSX ternary with literal strings", () => {
    const text = `<button>{count > 0 ? "Show " + count : "Empty"}</button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });
});

describe("scanIconOnlyButtons — negative / flag cases", () => {
  it("flags a button with only an svg and no text or aria", () => {
    const text = `<button onClick={onClick}><svg width="20" height="20"><path d="..." /></svg></button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(1);
  });

  it("flags a button with empty aria-label (treated as missing)", () => {
    const text = `<button aria-label=""><svg /></button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(1);
  });

  it("passes a button with a runtime text variable", () => {
    const text = `<button>{label}</button>`;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(0);
  });

	it("still flags a button whose only JSX expression is an icon", () => {
		const text = `<button>{enabled && <CloseIcon />}</button>`;
		expect(scanIconOnlyButtons("x.tsx", text)).toHaveLength(1);
	});

  it("flags a multi-line button correctly with correct line number", () => {
    const text = `
      <div>
        <button
          onClick={onClick}
          className="foo"
        >
          <svg />
        </button>
      </div>
    `;
    const findings = scanIconOnlyButtons("x.tsx", text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(3);
  });
});

describe("auditIconOnlyButtons — aggregation", () => {
  it("groups findings by file and counts total/flagged", () => {
    const files = [
      { path: "a.tsx", text: `<button><svg /></button><button aria-label="x">OK</button>` },
      { path: "b.tsx", text: `<button onClick={fn}><svg /></button>` },
    ];
    const summary = auditIconOnlyButtons(files);
    expect(summary.total).toBe(2);
    expect(summary.flagged).toBe(2);
    expect(summary.byFile["a.tsx"]).toHaveLength(1);
    expect(summary.byFile["b.tsx"]).toHaveLength(1);
  });

  it("returns zero totals on empty file list", () => {
    const summary = auditIconOnlyButtons([]);
    expect(summary.total).toBe(0);
    expect(summary.flagged).toBe(0);
    expect(summary.byFile).toEqual({});
  });

  it("omits files with no findings from byFile", () => {
    const files = [
      { path: "clean.tsx", text: `<button>OK</button>` },
      { path: "dirty.tsx", text: `<button><svg /></button>` },
    ];
    const summary = auditIconOnlyButtons(files);
    expect(summary.byFile["clean.tsx"]).toBeUndefined();
    expect(summary.byFile["dirty.tsx"]).toHaveLength(1);
  });
});
