cashier@demo.local / Cashier#2026 / demo
owner@demo.local / Owner#2026 / demo
accountant@demo.local / Accountant#2026 / demo
finance_demo@demo.local / Finance#2026 / demo
 

pip install psycopg2-binary pyotp cryptography

# First time: enroll a dev secret (seed has none for owner)
python scripts/generate_totp.py owner@demo.local --enroll

# Any time: print the current code (rotates every 30s)
python scripts/generate_totp.py owner@demo.local

# PowerShell shorthand
.\scripts\generate_totp.ps1 owner@demo.local -Enroll
.\scripts\generate_totp.ps1 owner@demo.local