"""Read-only WebDAV mount-entry smoke against the actual custom HTTP server.
Usage: python3 scripts/webdav-http-smoke.py http://127.0.0.1:3000
No credentials or storage mutation. Authenticated provider round trips live in Vitest fixtures.
"""
import sys
import urllib.request
import urllib.error

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000').rstrip('/')
for method in ('OPTIONS', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY'):
    req = urllib.request.Request(base + '/api/webdav/closeout-nonexistent', method=method)
    try:
        res = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        res = error
    expected = 204 if method == 'OPTIONS' else 401
    assert res.status == expected, (method, res.status, expected)
    assert res.headers.get('DAV') == '1', (method, 'DAV', res.headers.get('DAV'))
    if method != 'OPTIONS':
        assert 'Basic realm=' in res.headers.get('WWW-Authenticate', ''), (method, 'missing challenge')
    print(f'PASS {method}: {res.status}, DAV=1')
