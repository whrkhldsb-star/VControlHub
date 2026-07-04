const fs = require('fs');

// Fine-tune login form remember checkbox layout
let loginForm = fs.readFileSync('/opt/VControlHub/src/app/login/login-form.tsx', 'utf-8');
// Increase contrast and alignment of the checkbox
loginForm = loginForm.replace(
  'className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.03)] light:border-slate-200/80 light:shadow-sm"',
  'className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] px-4 py-3 text-xs font-medium text-[var(--text-primary)] shadow-sm"'
);
loginForm = loginForm.replace(
  'className="h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--surface)]/[0.10] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]/40 light:focus:ring-[var(--color-action-ring)]/30"',
  'className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)] bg-[var(--surface-subtle)] text-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"'
);

// We need to move the text to the right of the checkbox for a standard layout
loginForm = loginForm.replace(/<span>\{t\("login\.form\.remember", locale\)\}<\/span>\s*<input([\s\S]*?)>/m, '<input$1>\n\t\t\t\t<span>{t("login.form.remember", locale)}</span>');
fs.writeFileSync('/opt/VControlHub/src/app/login/login-form.tsx', loginForm);

console.log('Fixed checkbox layout');
