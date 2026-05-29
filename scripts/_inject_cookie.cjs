const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=["']?([^"'\n]+)["']?$/);
  if (m) env[m[1]] = m[2];
}

const postData = 'username=admin&password=' + encodeURIComponent('0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx') + '&next=%2F';

const options = {
  hostname: 'whrkhldsb.qzz.io',
  port: 443,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = https.request(options, (res) => {
  const cookies = res.headers['set-cookie'] || [];
  const sessionCookie = cookies.find(c => c.startsWith('vcontrolhub-session='));
  const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
  
  if (sessionCookie) {
    const sessionVal = sessionCookie.split(';')[0].split('=')[1];
    const csrfVal = csrfCookie ? csrfCookie.split(';')[0].split('=')[1] : '';
    
    // Generate browser set-cookie commands
    const lines = [
      `document.cookie = "vcontrolhub-session=${sessionVal}; path=/; SameSite=lax"`,
      `document.cookie = "csrf_token=${csrfVal}; path=/; SameSite=lax"`,
    ];
    fs.writeFileSync('/tmp/_vch_inject.js', lines.join('\n'));
    console.log('Injection script written to /tmp/_vch_inject.js');
    console.log('Session length:', sessionVal.length);
  } else {
    console.error('No session cookie found. Status:', res.statusCode);
  }
});

req.write(postData);
req.end();
