const fs = require('fs');

let loginDict = fs.readFileSync('/opt/VControlHub/src/lib/i18n/dictionaries/login.ts', 'utf-8');
// Fix Chinese translations to be more formal and enterprise-like
loginDict = loginDict.replace('"login.form.remember": "记住登录 30 天，减少频繁跳转登录页"', '"login.form.remember": "保持登录状态 (30天)"');
loginDict = loginDict.replace('"login.form.submit": "登录后台"', '"login.form.submit": "登录"');
loginDict = loginDict.replace('"login.branding.tagline": "，一站掌控。"', '"login.branding.tagline": "，一站式资源管理"');
loginDict = loginDict.replace('"login.verify2faDescription": "请输入您身份验证器应用中显示的验证码"', '"login.verify2faDescription": "请输入身份验证器应用 (Authenticator) 中生成的 6 位动态验证码"');

fs.writeFileSync('/opt/VControlHub/src/lib/i18n/dictionaries/login.ts', loginDict);

let authDict = fs.readFileSync('/opt/VControlHub/src/lib/i18n/dictionaries/auth.ts', 'utf-8');
// Fix some possible auth copy 
if (authDict.includes('"auth.two-factor"')) {
    authDict = authDict.replace('"auth.two-factor": "二步验证"', '"auth.two-factor": "双重认证 (2FA)"');
}
fs.writeFileSync('/opt/VControlHub/src/lib/i18n/dictionaries/auth.ts', authDict);

console.log('Fixed i18n copy');
