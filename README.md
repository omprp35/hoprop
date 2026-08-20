# Railway Live Desktop + Signup Automation v8

This version keeps the live noVNC desktop and adds one Telegram-controlled signup workflow.

## Telegram buttons

- ▶️ **Start Signup**
- 🖥 **Live Desktop**
- 🔄 **Restart Browser**
- ❌ **Close Browser**
- 🛑 **Cancel Signup**

## Signup workflow

1. Bot starts/reuses Chromium and verifies the **actual browser traffic** is India.
2. Bot asks the user for an email address.
3. Bot opens your custom extension popup, enters that email, clicks **Claim** then **Apply** (or a combined Claim/Apply button).
4. Bot waits for the Netflix tab opened by the extension.
5. Bot enters the same email on Netflix and clicks **Get Started**.
6. Bot clicks **Send Link**.
7. Bot asks the user to paste the Netflix link received by email.
8. Bot validates that it is an HTTPS `netflix.com` link, opens it in the **same Chromium profile**, and clicks **Finish Sign Up**.

The email and Netflix link are held only in process memory for the active workflow. They are not written to disk by this project.

## Surfshark

This project does **not** automate Surfshark location switching.

Use **Live Desktop** to log in and connect Surfshark to India manually. Recommended:

- Railway Volume mounted at `/data`
- `PROFILE_DIR=/data/browser-profile`
- Surfshark Auto-connect enabled after you confirm the India connection works manually

The signup workflow verifies the browser's external country before asking for the email. If India is not verified, it stops and asks you to fix Surfshark in Live Desktop.

## Custom extension

Put your unpacked extension directly in:

```text
extensions/custom/
```

Required:

```text
extensions/custom/manifest.json
```

The extension should expose a popup via either:

```json
"action": { "default_popup": "popup.html" }
```

or Manifest V2 `browser_action.default_popup`.

The automation looks for an email field and buttons whose visible names are `Claim` and `Apply`, or a combined `Claim & Apply` / `Claim and Apply` button.

## Railway variables

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
PUBLIC_URL=https://YOUR-SERVICE.up.railway.app
DESKTOP_USERNAME=browser
DESKTOP_PASSWORD=USE_A_STRONG_PASSWORD
PROFILE_DIR=/data/browser-profile
CUSTOM_EXTENSION_DIR=/app/extensions/custom
SURFSHARK_EXTENSION_DIR=/app/extensions/surfshark
APP_PORT=10001
```

Optional:

```text
AUTHORIZED_CHAT_IDS=123456789
```

## Important first test

Because the exact HTML of your custom extension and Netflix pages can change, test one signup while watching **Live Desktop**. If a selector fails, the bot will stop and tell you which stage failed instead of repeatedly clicking.

## Surfshark virtual-location manual confirmation

The automated location probe is advisory. Some public IP databases classify Surfshark virtual-India exits by their physical backend country. If the probe does not report India, the signup workflow is **paused, not cancelled**.

Use **🖥 Live Desktop** to inspect the same Chromium session. If your target/IP-check site shows India, press **✅ I Verified India**. The bot then continues to the email step. This manual confirmation applies only to the current signup workflow and is kept in memory only.
