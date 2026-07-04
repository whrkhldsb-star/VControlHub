import type { DiffRow } from "./text-preview-types";

export const LANG_MAP: Record<string, string> = {
	js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
	mjs: "javascript", cjs: "javascript",
	py: "python", pyw: "python",
	json: "json", jsonl: "json",
	yml: "yaml", yaml: "yaml",
	toml: "toml", ini: "toml", cfg: "toml", conf: "toml",
	sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
	html: "html", htm: "html", xml: "xml", xsl: "xml", xslt: "xml", svg: "xml",
	css: "css", scss: "css", sass: "css", less: "css",
	sql: "sql",
	go: "go", rs: "rust", java: "java", kt: "kotlin",
	c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
	rb: "ruby", php: "php", lua: "lua",
	dockerfile: "dockerfile", makefile: "makefile",
	env: "env", gitignore: "env",
	log: "log",
};

export function getLangFromName(name?: string): string {
	if (!name) return "text";
	const lower = name.toLowerCase();
	if (lower === "dockerfile" || lower === "makefile" || lower === "vagrantfile" || lower === "gemfile") return LANG_MAP[lower] ?? "text";
	const ext = lower.split(".").pop() ?? "";
	return LANG_MAP[ext] ?? "text";
}

export function buildLineDiff(before: string, after: string): DiffRow[] {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");
	const max = Math.max(beforeLines.length, afterLines.length);
	const rows: DiffRow[] = [];
	for (let i = 0; i < max; i += 1) {
		const previous = beforeLines[i];
		const next = afterLines[i];
		if (previous === next) continue;
		rows.push({
			line: i + 1,
			before: previous ?? "",
			after: next ?? "",
			kind: previous == null ? "added" : next == null ? "removed" : "changed",
		});
	}
	return rows;
}

/* Simple token-based syntax highlighting using regex.
   Strategy: extract comments/strings first as placeholders, highlight keywords, then restore. */


export function highlightLine(line: string, lang: string): string {
	if (lang === "text" || lang === "log") return escapeHtml(line);
	if (lang === "json") return highlightJson(line);
	
	let escaped = escapeHtml(line);
	
	const rules = getRules(lang);
	for (const rule of rules) {
		escaped = escaped.replace(rule.regex, rule.replace);
	}
	return escaped;
}

export function getRules(lang: string): { regex: RegExp; replace: string }[] {
	const commentRule = (prefix: string) => ({
		regex: new RegExp(`(${escapeRegex(escapeHtml(prefix))}.*)$`),
		replace: '<span class="text-[var(--text-muted)] italic">$1</span>',
	});
	
	const jsKeywords = "break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|interface|type|enum|implements|declare|namespace|module|as|readonly|abstract|override|private|protected|public";
	const pyKeywords = "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None";
	const shellKeywords = "if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|local|readonly|set|unset|echo|cd|mkdir|rm|cp|mv|cat|grep|sed|awk|find|chmod|chown|sudo|apt|yum|npm|pip|git|docker|systemctl";
	
	const kw = (words: string) => ({
		regex: new RegExp(`\\b(${words})\\b`, "g"),
		replace: '<span class="text-blue-400 font-medium">$1</span>',
	});
	
	const strRule = {
		regex: /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g,
		replace: '<span class="text-emerald-400">$1</span>',
	};
	
	const numRule = {
		regex: /\b(\d+\.?\d*)\b/g,
		replace: '<span class="text-amber-400">$1</span>',
	};
	
	const decoratorRule = {
		regex: /(@\w+)/g,
		replace: '<span class="text-purple-400">$1</span>',
	};
	
	const common: { regex: RegExp; replace: string }[] = [strRule, numRule];
	
	switch (lang) {
		case "javascript":
		case "typescript":
			return [commentRule("//"), kw(jsKeywords), decoratorRule, ...common];
		case "python":
			return [commentRule("#"), kw(pyKeywords), decoratorRule, ...common];
		case "shell":
			return [commentRule("#"), kw(shellKeywords), ...common];
		case "yaml":
		case "toml":
			return [
				commentRule("#"),
				{ regex: /^(\s*[\w.-]+)(\s*[:=]\s*)/gm, replace: '<span class="text-[var(--color-action)]">$1</span>$2' },
				...common,
			];
		case "env":
			return [
				commentRule("#"),
				{ regex: /^(\s*[\w.-]+)(=)/gm, replace: '<span class="text-[var(--color-action)]">$1</span><span class="text-[var(--text-muted)]">=</span>' },
				...common,
			];
		case "html":
		case "xml":
			return [
				commentRule("<!--"),
				{ regex: /(&lt;\/?[\w.-]+)/g, replace: '<span class="text-blue-400">$1</span>' },
				{ regex: /(\s[\w.-]+)(=)/g, replace: '<span class="text-[var(--color-action)]">$1</span><span class="text-[var(--text-muted)]">=</span>' },
				strRule,
			];
		case "css":
			return [
				commentRule("/*"),
				{ regex: /([.#]?[\w-]+)\s*\{/g, replace: '<span class="text-[var(--color-action)]">$1</span> {' },
				{ regex: /([\w-]+)(\s*:)/g, replace: '<span class="text-[var(--text-primary)]">$1</span>$2' },
				strRule,
			];
		case "sql":
			return [
				commentRule("--"),
				kw("SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|UNION|ALL|EXISTS|BETWEEN|CASE|WHEN|THEN|ELSE|END|ASC|DESC|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|AUTO_INCREMENT|IF|BEGIN|COMMIT|ROLLBACK|TRANSACTION|VIEW|PROCEDURE|FUNCTION|TRIGGER|GRANT|REVOKE|DATABASE|SCHEMA"),
				...common,
			];
		case "go":
			return [
				commentRule("//"),
				kw("break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false|iota|append|cap|close|copy|delete|len|make|new|panic|print|println|recover"),
				...common,
			];
		case "rust":
			return [
				commentRule("//"),
				kw("as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|unsafe|use|where|while|yield|true|false|Some|None|Ok|Err"),
				...common,
			];
		case "ruby":
			return [
				commentRule("#"),
				kw("alias|and|begin|break|case|class|def|defined|do|else|elsif|end|ensure|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|undef|unless|until|when|while|yield|true|false|require|include|attr|raise|puts"),
				decoratorRule,
				...common,
			];
		case "php":
			return [
				commentRule("//"),
				kw("abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|endfor|endforeach|endif|endswitch|endwhile|eval|exit|extends|final|finally|for|foreach|function|global|goto|if|implements|include|instanceof|insteadof|interface|isset|list|namespace|new|or|print|private|protected|public|require|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield|true|false|null"),
				{ regex: /(\$\w+)/g, replace: '<span class="text-[var(--accent)]">$1</span>' },
				...common,
			];
		default:
			return common;
	}
}

export function highlightJson(line: string): string {
	let escaped = escapeHtml(line);
	// keys
	escaped = escaped.replace(/^\s*(&quot;[^&]+?&quot;)\s*(:)/, '<span class="text-[var(--color-action)]">$1</span><span class="text-[var(--text-muted)]">:</span>');
	// string values
	escaped = escaped.replace(/:\s*(&quot;[^&]*?&quot;)([,\s}]*)$/, ': <span class="text-emerald-400">$1</span>$2');
	// standalone strings in arrays
	escaped = escaped.replace(/^\s*(&quot;[^&]*?&quot;)([,\s\]]*)$/, '<span class="text-emerald-400">$1</span>$2');
	// numbers
	escaped = escaped.replace(/:\s*(\d+\.?\d*)([,\s}]*)$/, ': <span class="text-amber-400">$1</span>$2');
	// booleans & null
	escaped = escaped.replace(/:\s*(true|false|null)([,\s}]*)$/, ': <span class="text-blue-400">$1</span>$2');
	return escaped;
}

export function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
