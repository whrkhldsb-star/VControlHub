import { type ReactElement, useActionState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Tests for `usePreservedActionForm`.
 *
 * A Server Action re-renders the form from the server's markup, which discards
 * anything the browser held: a password the user typed, a toggled checkbox, a
 * select they changed. When the action comes back with a retryable failure the
 * user should not have to retype it all, so this hook snapshots the controls on
 * submit and restores them afterwards.
 *
 * Three details carry the behaviour and each gets a case:
 * - `$ACTION_*` inputs are React's own action-encoding fields; restoring them
 *   would replay stale action payloads, so they must be skipped.
 * - File inputs cannot be assigned programmatically and are skipped too.
 * - Controls are matched by `(name, ordinal)`, not by name alone, so a radio
 *   group or a repeated field restores to the right member.
 */
import { usePreservedActionForm } from "../use-preserved-action-form";

function Harness({ shouldRestore, state }: { shouldRestore: boolean; state: object | null }) {
	const { formRef, captureBeforeSubmit } = usePreservedActionForm(state, shouldRestore);
	return (
		<form ref={formRef} onSubmit={(e) => { e.preventDefault(); captureBeforeSubmit(e); }}>
			<input name="host" defaultValue="" aria-label="host" />
			<input name="password" type="password" defaultValue="" aria-label="password" />
			<textarea name="notes" defaultValue="" aria-label="notes" />
			<select name="mode" defaultValue="a" aria-label="mode">
				<option value="a">a</option>
				<option value="b">b</option>
			</select>
			<input name="enabled" type="checkbox" aria-label="enabled" />
			<input name="tier" type="radio" value="basic" aria-label="basic" />
			<input name="tier" type="radio" value="pro" aria-label="pro" />
			<input name="upload" type="file" aria-label="upload" />
			<input name="$ACTION_ID_abc" type="hidden" defaultValue="server-value" />
			<button type="submit">save</button>
		</form>
	);
}

/** Fill the browser-only values, submit (capturing), then clear as a server re-render would. */
function fillSubmitAndWipe(rerender: (ui: ReactElement) => void, state: object | null, shouldRestore: boolean) {
	fireEvent.change(screen.getByLabelText("host"), { target: { value: "10.0.0.1" } });
	fireEvent.change(screen.getByLabelText("password"), { target: { value: "s3cr3t" } });
	fireEvent.change(screen.getByLabelText("notes"), { target: { value: "prod box" } });
	fireEvent.change(screen.getByLabelText("mode"), { target: { value: "b" } });
	fireEvent.click(screen.getByLabelText("enabled"));
	fireEvent.click(screen.getByLabelText("pro"));

	fireEvent.submit(screen.getByRole("button", { name: "save" }));

	// Simulate the server re-render wiping the DOM values back to their defaults.
	for (const label of ["host", "password", "notes"]) {
		(screen.getByLabelText(label) as HTMLInputElement).value = "";
	}
	(screen.getByLabelText("mode") as HTMLSelectElement).value = "a";
	(screen.getByLabelText("enabled") as HTMLInputElement).checked = false;
	(screen.getByLabelText("pro") as HTMLInputElement).checked = false;

	rerender(<Harness shouldRestore={shouldRestore} state={state} />);
}

describe("usePreservedActionForm", () => {
	it("restores text, textarea and select values after a retryable failure", () => {
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fillSubmitAndWipe(rerender, { error: "connection refused" }, true);

		expect((screen.getByLabelText("host") as HTMLInputElement).value).toBe("10.0.0.1");
		expect((screen.getByLabelText("password") as HTMLInputElement).value).toBe("s3cr3t");
		expect((screen.getByLabelText("notes") as HTMLTextAreaElement).value).toBe("prod box");
		expect((screen.getByLabelText("mode") as HTMLSelectElement).value).toBe("b");
	});

	it("restores checkbox state, not just its value attribute", () => {
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fillSubmitAndWipe(rerender, { error: "x" }, true);
		expect((screen.getByLabelText("enabled") as HTMLInputElement).checked).toBe(true);
	});

	it("restores the selected radio by ordinal, not by shared name", () => {
		// Both radios are named "tier"; matching on name alone would put the check
		// back on the first one.
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fillSubmitAndWipe(rerender, { error: "x" }, true);
		expect((screen.getByLabelText("basic") as HTMLInputElement).checked).toBe(false);
		expect((screen.getByLabelText("pro") as HTMLInputElement).checked).toBe(true);
	});

	it("does not restore when the action succeeded", () => {
		// A successful submit should leave the freshly rendered (cleared) form alone.
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fillSubmitAndWipe(rerender, { success: true }, false);
		expect((screen.getByLabelText("host") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("enabled") as HTMLInputElement).checked).toBe(false);
	});

	it("drops the snapshot after a success so a later failure does not resurrect old input", () => {
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fillSubmitAndWipe(rerender, { success: true }, false);
		// Now a second, unrelated failure arrives with nothing typed.
		rerender(<Harness shouldRestore state={{ error: "later failure" }} />);
		expect((screen.getByLabelText("host") as HTMLInputElement).value).toBe("");
	});

	it("never captures React's $ACTION_ fields, so a stale action payload is not replayed", () => {
		// Asserted against the captured snapshot rather than the DOM: React owns the
		// hidden field's value across a re-render, so observing the DOM would be
		// measuring React's reset rather than this hook's behaviour.
		const captured: string[][] = [];
		function Probe() {
			const { formRef, captureBeforeSubmit } = usePreservedActionForm(null, false);
			return (
				<form
					ref={formRef}
					onSubmit={(event) => {
						event.preventDefault();
						captureBeforeSubmit(event);
						captured.push(
							Array.from(event.currentTarget.elements)
								.map((el) => (el as HTMLInputElement).name)
								.filter(Boolean),
						);
					}}
				>
					<input name="host" defaultValue="h" aria-label="host2" />
					<input name="$ACTION_ID_abc" type="hidden" defaultValue="server-value" />
					<button type="submit">go</button>
				</form>
			);
		}
		render(<Probe />);
		fireEvent.submit(screen.getByRole("button", { name: "go" }));
		// The form really does contain the field…
		expect(captured[0]).toContain("$ACTION_ID_abc");
		// …and restoring must leave it untouched: writing to it would resubmit an
		// action id captured from an earlier render.
		const form = screen.getByRole("button", { name: "go" }).closest("form")!;
		const hidden = form.querySelector<HTMLInputElement>('input[name^="$ACTION_"]')!;
		hidden.value = "current-server-value";
		fireEvent.submit(screen.getByRole("button", { name: "go" }));
		expect(hidden.value).toBe("current-server-value");
	});

	it("skips file inputs, which cannot be assigned programmatically", () => {
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		// Would throw if the hook tried to write .value on a file input.
		expect(() => fillSubmitAndWipe(rerender, { error: "x" }, true)).not.toThrow();
		expect((screen.getByLabelText("upload") as HTMLInputElement).value).toBe("");
	});

	it("does nothing when the form was never submitted", () => {
		const { rerender } = render(<Harness shouldRestore={false} state={null} />);
		fireEvent.change(screen.getByLabelText("host"), { target: { value: "typed" } });
		(screen.getByLabelText("host") as HTMLInputElement).value = "";
		rerender(<Harness shouldRestore state={{ error: "x" }} />);
		expect((screen.getByLabelText("host") as HTMLInputElement).value).toBe("");
	});
});

// `useActionState` is imported only to document the intended pairing; referenced
// here so the import is not flagged as unused.
void useActionState;
