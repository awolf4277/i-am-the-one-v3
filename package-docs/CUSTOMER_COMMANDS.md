\# Customer Storefront Commands



Copyright © 2026 Andrew Wolverton. All Rights Reserved.



\## Start Backend



Open PowerShell:



```powershell

cd "X:\\i-am-the-one-v3\\backend"

.\\.venv\\Scripts\\Activate.ps1

python -m flask --app wsgi:app run --host 127.0.0.1 --port 5000

