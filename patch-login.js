const fs = require('fs');
const path = require('path');

// Fix LoginForm
const loginFormPath = '/opt/VControlHub/src/app/login/login-form.tsx';
let loginForm = fs.readFileSync(loginFormPath, 'utf-8');

// Replace standard input components
if (!loginForm.includes('import { Input }')) {
  loginForm = loginForm.replace(
    'import { t, type Locale } from "@/lib/i18n/translations";',
    'import { t, type Locale } from "@/lib/i18n/translations";\nimport { Input, StateBox } from "@/components/ui-primitives";'
  );
}

// Remove fieldClassName logic and swap inputs
loginForm = loginForm.replace(/const fieldClassName =[^;]+;/, '');
loginForm = loginForm.replace(/<input\s+id="username"([\s\S]*?)className=\{fieldClassName\}\s*\/>/m, '<Input id="username"$1 />');
loginForm = loginForm.replace(/<input\s+id="password"([\s\S]*?)className=\{fieldClassName\}\s*\/>/m, '<Input id="password"$1 />');

// Fix alert box
loginForm = loginForm.replace(
  /<div role="alert"[^>]*className="rounded-2xl border border-rose-400[^>]*>/,
  '<StateBox tone="danger" role="alert" className="mb-4">'
);
loginForm = loginForm.replace(/<\/div>\s*\}\s*<button/, '</StateBox>\n\t\t\t\t}\n\t\t\t\t<button');

// Fix button (SaaS primary CTA style)
loginForm = loginForm.replace(
  /className="w-full rounded-2xl bg-gradient[^"]+"/,
  'data-variant="primary" className="w-full py-2.5 text-sm font-semibold"'
);

fs.writeFileSync(loginFormPath, loginForm);

// Fix verify-2fa-form
const verifyFormPath = '/opt/VControlHub/src/app/login/verify-2fa/verify-2fa-form.tsx';
let verifyForm = fs.readFileSync(verifyFormPath, 'utf-8');

if (!verifyForm.includes('import { StateBox }')) {
  verifyForm = verifyForm.replace(
    'import { useRouter } from "next/navigation";',
    'import { useRouter } from "next/navigation";\nimport { StateBox } from "@/components/ui-primitives";'
  );
}

// Use StateBox for error
verifyForm = verifyForm.replace(
  /<div className="rounded-xl bg-rose-500\/\[0\.10\][^"]+">([\s\S]*?)<\/div>/,
  '<StateBox tone="danger" className="py-2.5 text-center">\n\t\t\t\t\t$1\n\t\t\t\t</StateBox>'
);

// Fix input styles for 2FA digit boxes
verifyForm = verifyForm.replace(
  /className="h-14 w-12 rounded-xl bg-\[var\(--surface\)\]\/\[0\.04\][^"]+"/,
  'className="h-14 w-12 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-center text-xl font-semibold text-[var(--text-primary)] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 focus:border-[var(--input-border-focus)] focus:bg-[var(--input-bg-focus)] focus:ring-[3px] focus:ring-[var(--input-ring)] disabled:opacity-50"'
);

// Fix button
verifyForm = verifyForm.replace(
  /className="w-full rounded-xl bg-gradient[^"]+"/,
  'data-variant="primary" className="w-full py-2.5 text-sm font-semibold"'
);

fs.writeFileSync(verifyFormPath, verifyForm);

console.log('Login forms patched');
