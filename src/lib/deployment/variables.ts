import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";

export type DeploymentShell = "posix" | "cmd" | "mixed";

function invalid(): never {
  throw new ValidationError(t("backend.deployment.invalidVariablesJson"));
}

function validateValue(name: string, value: string, shell: DeploymentShell) {
  if (value.includes("\0")) invalid();
  if (name === "project_dir") {
    const path = shell === "cmd" ? value.replaceAll("\\", "/") : value;
    const absolute = path.startsWith("/") || (shell === "cmd" && /^[A-Za-z]:\//.test(path));
    if (!absolute || path.split("/").includes("..") || /[\r\n]/.test(path)) invalid();
  }
  if (["days", "count", "port"].includes(name) &&
    (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || (name === "port" && (Number(value) < 1 || Number(value) > 65535)))) invalid();
  if (["service", "container"].includes(name) && !/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(value)) invalid();
}

/** Values travel in argv. Only parameter references are inserted into the shell program. */
export function renderDeploymentCommand(template: string, variables: Record<string, string>, shell: DeploymentShell = "posix") {
  if (!/\{\{\w+\}\}/.test(template)) return template;
  if (shell !== "posix") return renderCmdOrMixed(template, variables, shell);
  const values: string[] = [];
  const params = new Map<string, string>();
  let prefix = "VCH_DEPLOY_VALUE_";
  while (template.includes(prefix)) prefix += "_";
  function parameter(name: string) {
    if (!Object.hasOwn(variables, name)) throw new ValidationError(t("backend.deployment.invalidVariablesJson"));
    if (!params.has(name)) {
      validateValue(name, variables[name]!, shell);
      values.push(variables[name]!);
      params.set(name, "${" + prefix + values.length + "}");
    }
    return params.get(name)!;
  }
  // A quoted here-document deliberately disables shell expansion. Move a
  // data-only body to printf so multi-line values never become shell syntax.
  const program = template.replace(/\bcat\s+<<'([A-Za-z_]\w*)'\n\{\{(\w+)\}\}\n\1(?=\n|$)/g,
    (_, _delimiter: string, name: string) => "printf '%s\\n' \"" + parameter(name) + "\"");
  let quote = "";
  let body = "";
  for (const match of program.matchAll(/\\[\s\S]|['"]|\{\{(\w+)\}\}|[\s\S]/g)) {
    const token = match[0];
    if (match[1]) {
      const arg = parameter(match[1]);
      body += quote === '"' ? arg : quote === "'" ? "'\"" + arg + "\"'" : '"' + arg + '"';
    } else {
      body += token;
      if (token === quote) quote = "";
      else if (!quote && (token === '"' || token === "'")) quote = token;
    }
  }
  const bindings = values.map((_, i) => `readonly ${prefix}${i + 1}="\${${i + 1}}"`);
  const command = ["sh", "-c", shellQuote([...bindings, body].join("\n")), "deploy", ...values.map(shellQuote)].join(" ");
  if (command.length > 10_000) throw new ValidationError(t("backend.deployment.invalidVariablesJson"));
  return command;
}

// Windows agents start cmd.exe. Delayed expansion inserts environment values after
// cmd has parsed redirects and separators. Double-quote for native argv parsing.
function renderCmdOrMixed(template: string, variables: Record<string, string>, shell: "cmd" | "mixed") {
  let quoted = false;
  const args: string[] = [];
  const program = template.replace(/\^.|"|\{\{(\w+)\}\}/g, (token, name?: string) => {
    if (!name) {
      if (token === '"') quoted = !quoted;
      return token;
    }
    if (!Object.hasOwn(variables, name)) invalid();
    const value = variables[name]!;
    validateValue(name, value, shell);
    let parameter: string;
    if (shell === "mixed") {
      // A shared approval stores one command for both interpreters. Only
      // literal characters with identical meaning can appear in both.
      if (!/^[A-Za-z0-9 _/@.,:+-]+$/.test(value)) invalid();
      parameter = value;
    } else {
      args.push(value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, "$&$&"));
      parameter = "!VCH_DEPLOY_ARG_" + args.length + "!";
    }
    return quoted ? parameter : '"' + parameter + '"';
  });
  if (shell === "mixed") {
    if (program.length > 8000) invalid();
    return program;
  }
  // The command crossing the outer cmd.exe contains only a fixed launcher
  // and encoded data. Even multiline values travel separately from the script.
  const data = Buffer.from(JSON.stringify({ program, args }), "utf8").toString("base64");
  const launcher = [
    "$ErrorActionPreference='Stop'",
    "$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + data + "')) | ConvertFrom-Json",
    "$p=New-Object Diagnostics.ProcessStartInfo",
    "$p.FileName=$env:ComSpec",
    "$p.UseShellExecute=$false",
    "$p.Arguments='/d /s /v:on /c \"'+$d.program+'\"'",
    "for($i=0;$i -lt $d.args.Count;$i++){$p.EnvironmentVariables['VCH_DEPLOY_ARG_'+($i+1)]=$d.args[$i]}",
    "$c=[Diagnostics.Process]::Start($p)",
    "$c.WaitForExit()",
    "exit $c.ExitCode",
  ].join("\n");
  const command = "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(launcher, "utf16le").toString("base64");
  // cmd.exe has an 8191-character limit including the Agent's code-page prefix.
  if (command.length > 8000) invalid();
  return command;
}
