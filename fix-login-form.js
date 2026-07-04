const fs = require('fs');
let content = fs.readFileSync('/opt/VControlHub/src/app/login/login-form.tsx', 'utf-8');
content = content.replace(/<\/div>\n\t\t\t\) : null\}/, '</StateBox>\n\t\t\t) : null}');
fs.writeFileSync('/opt/VControlHub/src/app/login/login-form.tsx', content);
