import os
import sys

# Load DATABASE_URL from .env.runtime
db_url = None
with open('/opt/VControlHub/.env.runtime') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DATABASE_URL='):
            db_url = line.split('=', 1)[1].strip('"')
            break

if not db_url:
    print("ERROR: DATABASE_URL not found")
    sys.exit(1)

try:
    import bcrypt
    import psycopg2
except ImportError:
    # Try installing
    os.system('pip install bcrypt psycopg2-binary')
    import bcrypt
    import psycopg2

conn = psycopg2.connect(db_url)
cur = conn.cursor()

password = 'admin2xvjl2cp'
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()
print('Generated hash:', password_hash)

cur.execute('UPDATE "User" SET "passwordHash" = %s WHERE username = %s RETURNING username', (password_hash, 'admin'))
conn.commit()

# Verify
cur.execute('SELECT "passwordHash" FROM "User" WHERE username = %s', ('admin',))
row = cur.fetchone()
print('DB hash length:', len(row[0]) if row else 'N/A')

# Verify password
stored_hash = row[0].encode()
if bcrypt.checkpw(password.encode(), stored_hash):
    print('Password verification: OK')
else:
    print('Password verification: FAILED')

cur.close()
conn.close()
