const fs = require('fs');

// Patch 1: Enhance `globals.css`
let css = fs.readFileSync('/opt/VControlHub/src/app/globals.css', 'utf-8');

// Ensure standard form background definitions exist in variables
if (!css.includes('--input-bg-focus:')) {
	css = css.replace('--input-bg: #0d1117;', '--input-bg: #0d1117;\n\t--input-bg-focus: #161b22;\n\t--input-ring: rgba(88,166,255,0.2);\n\t--input-ring-danger: rgba(248,81,73,0.2);\n\t--input-ring-success: rgba(63,185,80,0.2);');
}
if (css.includes('/* === Light theme (GitHub Light 启发) === */')) {
	const lightTheme = css.match(/--input-bg:\s*[^;]+;/);
	if (!css.includes('--input-bg-focus:', css.indexOf('/* === Light theme'))) {
		css = css.replace(/(--input-bg:\s*[^;]+;)/g, (match, p1, offset) => {
			if (offset > css.indexOf('/* === Light theme')) {
				return p1 + '\n\t--input-bg-focus: #ffffff;\n\t--input-ring: rgba(9,105,218,0.2);\n\t--input-ring-danger: rgba(207,34,46,0.2);\n\t--input-ring-success: rgba(26,127,55,0.2);';
			}
			return p1;
		});
	}
}

// Add Glassmorphism / UI Primitives extensions
const glassExt = `
/* UI Primitives Data Attribute Extensions */
[data-input] {
	background-color: var(--input-bg);
	border: 1px solid var(--input-border);
	color: var(--text-primary);
	border-radius: var(--radius-lg);
	transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
[data-input]:focus-within, [data-input]:focus {
	border-color: var(--input-border-focus);
	background-color: var(--input-bg-focus);
	box-shadow: 0 0 0 3px var(--input-ring);
	outline: none;
}
[data-input][data-error="true"] {
	border-color: var(--danger);
}
[data-input][data-error="true"]:focus-within, [data-input][data-error="true"]:focus {
	box-shadow: 0 0 0 3px var(--input-ring-danger);
}
[data-input]:disabled, [data-input][aria-disabled="true"] {
	opacity: 0.6;
	cursor: not-allowed;
	background-color: var(--surface-subtle);
}

[data-state-box] {
	border-radius: var(--radius-xl);
	padding: 1rem;
	border: 1px solid var(--border);
	background-color: var(--surface-subtle);
}
[data-state-box="danger"] {
	background-color: var(--danger-bg);
	border-color: var(--danger-border);
	color: var(--danger);
}
[data-state-box="warning"] {
	background-color: var(--warning-bg);
	border-color: var(--warning-border);
	color: var(--warning);
}
[data-state-box="success"] {
	background-color: var(--success-bg);
	border-color: var(--success-border);
	color: var(--success);
}
[data-state-box="accent"] {
	background-color: var(--accent-bg);
	border-color: var(--accent-border);
	color: var(--accent);
}
`;

if (!css.includes('[data-input] {')) {
	css += '\n' + glassExt;
}

fs.writeFileSync('/opt/VControlHub/src/app/globals.css', css);

// Patch 2: Enhance ui-primitives.tsx
let ui = fs.readFileSync('/opt/VControlHub/src/components/ui-primitives.tsx', 'utf-8');
const uiExt = `
/* ════════════════════════════════════════════════════════════════
 * Input, Select, Textarea — 表单控件
 * 统一所有表单元素的边框、圆角、获取焦点态
 * ════════════════════════════════════════════════════════════════ */

export function Input({ className, hasError, ...rest }: { hasError?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			data-input
			data-error={hasError ? "true" : undefined}
			className={\`block w-full px-3 py-2 text-sm placeholder:text-[var(--text-muted)] \${className ?? ""}\`}
			{...rest}
		/>
	);
}

export function Select({ className, hasError, children, ...rest }: { hasError?: boolean; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			data-input
			data-error={hasError ? "true" : undefined}
			className={\`block w-full px-3 py-2 text-sm \${className ?? ""}\`}
			{...rest}
		>
			{children}
		</select>
	);
}

export function Textarea({ className, hasError, ...rest }: { hasError?: boolean } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			data-input
			data-error={hasError ? "true" : undefined}
			className={\`block w-full px-3 py-2 text-sm placeholder:text-[var(--text-muted)] \${className ?? ""}\`}
			{...rest}
		/>
	);
}

/* ════════════════════════════════════════════════════════════════
 * StateBox — 状态提示框
 * 取代大量的 \`bg-rose-500/10 text-rose-200 border border-rose-400/20\`
 * ════════════════════════════════════════════════════════════════ */

export type StateBoxTone = "danger" | "warning" | "success" | "accent" | "neutral";

export function StateBox({ tone = "neutral", children, className, ...rest }: { tone?: StateBoxTone; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-state-box={tone}
			className={\`text-sm \${className ?? ""}\`}
			{...rest}
		>
			{children}
		</div>
	);
}
`;

if (!ui.includes('export function Input(')) {
	ui += '\n' + uiExt;
	fs.writeFileSync('/opt/VControlHub/src/components/ui-primitives.tsx', ui);
}
console.log('Patched globals.css and ui-primitives.tsx');
