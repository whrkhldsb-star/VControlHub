const fs = require('fs');

// Patch 1: app/login/page.tsx
let loginPage = fs.readFileSync('/opt/VControlHub/src/app/login/page.tsx', 'utf-8');
// Fix backgrounds and tokens
loginPage = loginPage.replace(/bg-\[radial-gradient\([^\]]+\)\] light:bg-\[radial-gradient\([^\]]+\)\]/, 'bg-[radial-gradient(ellipse_at_top,var(--accent-bg),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.06),transparent_35%),linear-gradient(180deg,var(--background)_0%,var(--surface-subtle)_100%)]');
loginPage = loginPage.replace(/via-white\/10 to-transparent light:via-\[var\(--color-action\)\]\/50/, 'via-[var(--border-strong)] to-transparent');
loginPage = loginPage.replace(/bg-\[var\(--surface\)\]\/\[0\.10\].*?light:backdrop-blur/, 'bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-primary)] shadow-sm backdrop-blur');
loginPage = loginPage.replace(/bg-\[var\(--color-action-bg\)\] shadow-\[0_0_8px_rgba\(34,211,238,0\.55\)\] light:bg-\[var\(--color-action\)\] light:shadow-\[0_0_8px_rgba\(6,182,212,0\.55\)\]/, 'bg-[var(--accent)] shadow-[0_0_8px_var(--accent-border)]');
loginPage = loginPage.replace(/text-\[var\(--color-action\)\]/g, 'text-[var(--accent)]');
loginPage = loginPage.replace(/bg-\[var\(--surface\)\]\/\[0\.04\].*?sm:p-8 light:border light:shadow-\[0_24px_70px_rgba\(15,23,42,0\.14\)\]/, 'bg-[var(--surface)] border border-[var(--border)] p-6 shadow-[var(--shadow-xl)] sm:p-8');
loginPage = loginPage.replace(/bg-\[var\(--surface\)\]\/\[0\.04\].*?light:shadow-\[var\(--border\)\]\/30/, 'bg-[var(--surface-subtle)] border border-[var(--border)] p-3.5 shadow-sm');
fs.writeFileSync('/opt/VControlHub/src/app/login/page.tsx', loginPage);

// Patch 2: app/login/verify-2fa/page.tsx
let verifyPage = fs.readFileSync('/opt/VControlHub/src/app/login/verify-2fa/page.tsx', 'utf-8');
verifyPage = verifyPage.replace(/bg-\[radial-gradient\([^\]]+\)\]/g, 'bg-[radial-gradient(ellipse_at_top,var(--accent-bg),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.06),transparent_35%),linear-gradient(180deg,var(--background)_0%,var(--surface-subtle)_100%)]');
verifyPage = verifyPage.replace(/via-white\/10 to-transparent/, 'via-[var(--border-strong)] to-transparent');
verifyPage = verifyPage.replace(/bg-\[var\(--surface\)\]\/\[0\.04\] p-6 shadow-\[[^\]]+\] backdrop-blur-xl sm:p-8/, 'bg-[var(--surface)] border border-[var(--border)] p-6 shadow-[var(--shadow-xl)] sm:p-8');
verifyPage = verifyPage.replace(/bg-\[var\(--color-action\)\]\/10/g, 'bg-[var(--accent-bg)]');
verifyPage = verifyPage.replace(/text-\[var\(--color-action\)\]/g, 'text-[var(--accent)]');
verifyPage = verifyPage.replace(/light:hover:text-\[var\(--text-primary\)\]\/50/g, 'hover:text-[var(--text-primary)]');
fs.writeFileSync('/opt/VControlHub/src/app/login/verify-2fa/page.tsx', verifyPage);

console.log('Login pages backgrounds patched');
