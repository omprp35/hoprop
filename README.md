# Telegram + Render + Playwright + Chrome Extensions

This starter runs a Telegram webhook on Render. `/run` launches Chromium with:

1. your unpacked Chrome extension (`extensions/custom`)
2. the Surfshark Chrome extension, downloaded automatically during the Docker build (`extensions/surfshark`)

It waits briefly for extension auto-connect, verifies that the public IP country is India, opens `TARGET_URL`, runs `src/user-automation.js`, and sends a screenshot/result to Telegram.

## 1. Put your extension in the project

Your extension:

```text
extensions/custom/manifest.json
```

Do not nest it one extra folder deep.

**Surfshark is automatic.** During `docker build`, `scripts/download-surfshark.js` downloads the official Surfshark Chrome extension and extracts it into `extensions/surfshark`. You do not need to upload Surfshark manually.

## 2. Surfshark setup

In a persistent Chromium profile, log in to Surfshark and set:

- Default location: **India**
- **Auto-connect: ON**

The bot verifies the country before it runs your target-site automation.

### Render Free limitation

Render Free uses an ephemeral filesystem. A browser login/profile created at runtime can be lost after the service spins down/restarts/redeploys.

For initial testing:

```text
PROFILE_DIR=/tmp/browser-profile
```

For reliable Surfshark login persistence, use a paid Render service with a persistent disk mounted at `/var/data`, then use:

```text
PROFILE_DIR=/var/data/browser-profile
```

## 3. Customize the automation

Edit:

```text
src/user-automation.js
```

Example:

```js
await page.goto(targetUrl);
await page.fill('#email', 'example@example.com');
await page.click('#continue');
```

## 4. Create the Telegram bot

Create a bot with Telegram's @BotFather and copy its token.

## 5. Deploy to Render

Push this folder to a GitHub repository.

In Render:

1. New -> Web Service
2. Connect the GitHub repository
3. Runtime/Language -> Docker
4. Choose your service plan
5. Add environment variables

Required:

```text
TELEGRAM_BOT_TOKEN=...
PUBLIC_URL=https://YOUR-SERVICE.onrender.com
TELEGRAM_WEBHOOK_SECRET=some_long_random_value
TARGET_URL=https://example.com
EXPECTED_COUNTRY=IN
PROFILE_DIR=/tmp/browser-profile
CUSTOM_EXTENSION_DIR=/app/extensions/custom
SURFSHARK_EXTENSION_DIR=/app/extensions/surfshark
```

The Docker build downloads Surfshark automatically. The default official extension ID is `ailoabdmgclmfmhdagmlohpjlbpffblp`.

Optional security:

```text
AUTHORIZED_CHAT_IDS=123456789
```

If you don't know the chat ID yet, leave it blank, deploy, message `/id`, then set `AUTHORIZED_CHAT_IDS` to that number and redeploy.

## 6. Telegram commands

```text
/start
/run
/status
/id
```

`/run` performs:

```text
Telegram
 -> Render webhook
 -> Chromium
 -> Surfshark extension auto-connect
 -> verify India IP
 -> your Chrome extension
 -> your automation
 -> screenshot/result to Telegram
```

## Health route

```text
GET /health
```

returns `ok`.

## Security notes

- Never commit Telegram tokens or Surfshark credentials to GitHub.
- Use Render environment variables/secrets.
- Prefer a private GitHub repository if your custom extension is proprietary.
- Restrict the bot using `AUTHORIZED_CHAT_IDS` before production use.

## Telegram buttons

Send `/start` once. The bot now shows persistent buttons for:

- 🔐 Surfshark Login
- 🇮🇳 Connect India
- 🌍 VPN Status
- ▶️ Run Automation
- 📊 Bot Status
- 🆔 My ID

`Connect India` opens Surfshark's location list control, searches for India, selects the top India/Fastest result, and verifies the browser public IP is actually in India before reporting success.

## India connection v4
The Connect India action now performs a clean disconnect before changing locations, then automatically tries Mumbai, Delhi, and India/Fastest until multiple independent IP-geolocation checks confirm India. This prevents a stale previous Surfshark tunnel from remaining active while the UI shows a newly selected India location.

## Manual browser session (Telegram remote control)

This build adds a manual persistent Chromium session so you can inspect Surfshark or any public webpage yourself from Telegram.

Tap **🖥 Manual Session**. The bot keeps the same Chromium context open and sends a screenshot. Session buttons let you open Surfshark, open an IP-check page, take screenshots, show a coordinate grid, scroll, refresh, and close the session.

Commands available while the session is active:

```text
/open example.com
/click 640 450
/type india
/key Enter
/session_screenshot
/session_grid
/session_close
```

The browser viewport is **1280×900**. Use **🧭 Coordinate Grid** to make `/click X Y` easier. The session automatically closes after 15 minutes of inactivity by default; change `MANUAL_SESSION_MINUTES` if needed.

For security, `/open` blocks localhost/private-network addresses. Avoid sending passwords with `/type`, because Telegram stores your message history. Use Surfshark's device login-code flow instead.
