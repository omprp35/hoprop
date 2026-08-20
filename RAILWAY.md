# Railway setup

Use these Railway variables:

- TELEGRAM_BOT_TOKEN = your BotFather token
- TELEGRAM_WEBHOOK_SECRET = a long random string
- PUBLIC_URL = your Railway public HTTPS URL, without a trailing slash
- TARGET_URL = website your automation should open
- EXPECTED_COUNTRY = IN
- CUSTOM_EXTENSION_DIR = /app/extensions/custom
- SURFSHARK_EXTENSION_DIR = /app/extensions/surfshark
- PROFILE_DIR = /data/browser-profile (recommended with a Railway Volume mounted at /data)
- AUTHORIZED_CHAT_IDS = your Telegram chat ID (recommended)
- PORT = 10000 (optional; Railway can also inject PORT)

Set Railway healthcheck path to:

/health

Recommended persistent volume:

Mount path: /data

Then use PROFILE_DIR=/data/browser-profile so Surfshark login/session data survives redeploys/restarts.

Telegram commands:

/surfshark_login
/connect_india
/surfshark_status
/run
/status
/id
