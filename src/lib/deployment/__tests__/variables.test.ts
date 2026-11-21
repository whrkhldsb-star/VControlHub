// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderDeploymentCommand } from "../variables";

describe.skipIf(process.platform === "win32")("POSIX deployment and rollback arguments", () => {
  function output(template: string, variables: Record<string, string>) {
    return execFileSync("sh", ["-c", renderDeploymentCommand(template, variables)], { encoding: "utf8" });
  }

  it("keeps spaces, quotes and newlines inside one argument in each quoting context", () => {
    const value = "first file's \"title\"\nsecond $line";
    const template = `printf '[%s]\\n' {{file}} "{{file}}" '{{file}}'`;
    expect(output(template, { file: value })).toBe((`[${value}]\n`).repeat(3));
    expect(output("printf '%s' {{project_dir}}", { project_dir: "/srv/app releases" })).toBe("/srv/app releases");
  });

  it("delivers a multiline here-document as data even when a line equals its delimiter", () => {
    const content = "first\nDOCUMENT\nsecond";
    expect(output("cat <<'DOCUMENT'\n{{body}}\nDOCUMENT", { body: content })).toBe(content + "\n");
  });
});

it.each([
  ["project_dir", "relative"], ["project_dir", "/srv/../other"], ["port", "65536"],
  ["days", "-1"], ["count", "2.5"], ["service", "-all"], ["container", "two names"],
])("validates the typed variable %s before recording a deployment", (name, value) => {
  expect(() => renderDeploymentCommand("echo {{" + name + "}}", { [name]: value })).toThrow();
});

it("keeps Windows command data out of cmd syntax and validates Windows paths", () => {
  const value = "two words\n%TEMP% & final";
  const command = renderDeploymentCommand('tool "{{body}}" {{project_dir}}', { body: value, project_dir: "C:\\App Data" }, "cmd");
  const launcher = Buffer.from(command.split(" ").at(-1)!, "base64").toString("utf16le");
  const payload = launcher.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1]!;
  expect(JSON.parse(Buffer.from(payload, "base64").toString())).toEqual({
    program: 'tool "!VCH_DEPLOY_ARG_1!" "!VCH_DEPLOY_ARG_2!"', args: [value, "C:\\App Data"],
  });
  expect(renderDeploymentCommand("tool {{file}}", { file: "two words" }, "mixed")).toBe('tool "two words"');
  expect(() => renderDeploymentCommand("tool {{file}}", { file: value }, "mixed")).toThrow();
});

it.skipIf(process.platform !== "win32")("passes a spaced argument to a native Windows process", () => {
  const template = 'node -p "process.argv[1]" {{file}}';
  const command = renderDeploymentCommand(template, { file: "a & b" }, "cmd");
  expect(execFileSync("cmd.exe", ["/d", "/c", command], { encoding: "utf8" }).trim()).toBe("a & b");
});
