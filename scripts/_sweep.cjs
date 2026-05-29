// CDP-based cookie injection and page sweep
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

// Step 1: Get session cookie
function getCookie() {
  return new Promise((resolve, reject) => {
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
        resolve({
          session: sessionCookie.split(';')[0].split('=')[1],
          csrf: csrfCookie ? csrfCookie.split(';')[0].split('=')[1] : '',
        });
      } else {
        reject(new Error('No session cookie'));
      }
    });
    req.write(postData);
    req.end();
  });
}

// Step 2: Fetch a page with the cookie
function fetchPage(pagePath, cookie) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'whrkhldsb.qzz.io',
      port: 443,
      path: pagePath,
      method: 'GET',
      headers: {
        'Cookie': `vcontrolhub-session=${cookie.session}; csrf_token=${cookie.csrf}`,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        // Check for JS errors in the HTML
        const _hasError = body.includes('error') || body.includes('Error');
        // Extract page title
        const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1] : 'No title';
        // Check for common issues
        const issues = [];
        if (res.statusCode >= 400) issues.push(`HTTP ${res.statusCode}`);
        if (body.includes('502') || body.includes('Bad Gateway')) issues.push('502 Bad Gateway');
        if (body.includes('500') || body.includes('Internal Server Error')) issues.push('500 Internal Server Error');
        // Check for console errors patterns in script tags
        const scriptErrors = body.match(/console\.error|uncaught|TypeError/gi);
        if (scriptErrors) issues.push(`Script errors found: ${scriptErrors.length}`);
        
        resolve({
          path: pagePath,
          status: res.statusCode,
          title,
          issues,
          size: body.length,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const cookie = await getCookie();
  console.log('Got session cookie');
  
  const pages = [
    '/', '/servers', '/files', '/quick-services', '/settings', '/audit',
    '/tickets', '/announcements', '/ai', '/alert-rules', '/api-docs',
    '/api-tokens', '/backups', '/deployments', '/docker', '/downloads',
    '/health', '/image-bed', '/media', '/monitoring', '/notifications',
    '/operation-tasks', '/preferences', '/requests', '/scheduled-tasks',
    '/shares', '/snippets', '/account/password'
  ];
  
  const results = [];
  for (const page of pages) {
    try {
      const r = await fetchPage(page, cookie);
      results.push(r);
      const status = r.issues.length > 0 ? `ISSUES: ${r.issues.join(', ')}` : 'OK';
      console.log(`${r.path} -> ${r.status} (${r.size}b) [${status}]`);
    } catch (e) {
      console.log(`${page} -> ERROR: ${e.message}`);
      results.push({ path: page, status: 'error', issues: [e.message] });
    }
  }
  
  // Write results
  fs.writeFileSync('/tmp/_vch_sweep.json', JSON.stringify(results, null, 2));
  console.log('\nResults written to /tmp/_vch_sweep.json');
}

main().catch(e => { console.error(e.message); process.exit(1); });
