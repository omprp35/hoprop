const express = require('express');
const fs = require('fs');
const config = require('./config');
const { sendMessage, sendMenu, sendSessionMenu, sendPhoto, setupWebhook } = require('./telegram');
const { runAutomation, launchBrowser } = require('./automation');
const { checkPublicIp } = require('./vpn-check');
const { requestLoginCode, waitForLogin, connectIndia } = require('./surfshark');
const { ManualSession } = require('./manual-session');

const app = express();
app.use(express.json({ limit: '1mb' }));

let running = false;
let lastStatus = 'idle';
let lastRunAt = null;
const manualSession = new ManualSession();

function isAuthorized(chatId) {
  return config.authorizedChatIds.size === 0 || config.authorizedChatIds.has(String(chatId));
}

async function withBrowser(task) {
  const { context } = await launchBrowser();
  try {
    return await task(context);
  } finally {
    await context.close().catch(() => {});
  }
}

async function sendManualScreenshot(chatId, grid = false) {
  const shot = await manualSession.screenshot(chatId, { grid });
  try {
    const caption = grid
      ? '🧭 1280×900 coordinate grid. Use /click X Y, for example /click 640 450.'
      : `📸 Manual browser\n${shot.title || '(no title)'}\n${shot.url || ''}`;
    await sendPhoto(chatId, shot.filePath, caption);
  } finally {
    if (shot.filePath && fs.existsSync(shot.filePath)) fs.unlink(shot.filePath, () => {});
  }
}

function manualHelpText() {
  return (
    '🖥 Manual browser session is active.\n\n' +
    'Use the buttons below, or these commands:\n' +
    '/open example.com - open a public website\n' +
    '/click X Y - click the 1280×900 viewport\n' +
    '/type TEXT - type into the currently focused field\n' +
    '/key Enter - press Enter (also Tab, Escape, arrows, etc.)\n' +
    '/session_screenshot - current browser screenshot\n' +
    '/session_grid - screenshot with coordinate grid\n' +
    '/session_close - close the hosted browser\n\n' +
    'Tip: tap 🦈 Open Surfshark, then use the grid/screenshot to inspect or click it manually.\n' +
    'Do not type passwords with /type because Telegram keeps message history.'
  );
}

app.get('/', async (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-browser-automation',
    status: running ? 'running' : lastStatus,
    manualSession: manualSession.active,
    lastRunAt
  });
});

app.get('/health', (req, res) => res.status(200).send('ok'));

app.post('/telegram', async (req, res) => {
  const secret = req.get('x-telegram-bot-api-secret-token');
  if (secret !== config.webhookSecret) {
    return res.status(401).json({ ok: false });
  }

  // Reply to Telegram immediately; commands continue in this Railway process.
  res.status(200).json({ ok: true });

  const message = req.body?.message;
  const chatId = message?.chat?.id;
  const rawText = message?.text?.trim();
  if (!chatId || !rawText) return;

  const BUTTON_COMMANDS = {
    '🖥 Manual Session': '/session_start',
    '🔐 Surfshark Login': '/surfshark_login',
    '🇮🇳 Connect India': '/connect_india',
    '🌍 VPN Status': '/surfshark_status',
    '▶️ Run Automation': '/run',
    '📊 Bot Status': '/status',
    '🆔 My ID': '/id',
    '🦈 Open Surfshark': '/session_surfshark',
    '🌐 Open IP Check': '/session_ipcheck',
    '📸 Screenshot': '/session_screenshot',
    '🧭 Coordinate Grid': '/session_grid',
    '⬆️ Scroll Up': '/session_scroll_up',
    '⬇️ Scroll Down': '/session_scroll_down',
    '🔄 Refresh': '/session_refresh',
    '❌ Close Session': '/session_close',
    '🏠 Main Menu': '/menu'
  };
  const text = BUTTON_COMMANDS[rawText] || rawText;

  try {
    if (!isAuthorized(chatId)) {
      await sendMessage(chatId, `Not authorized. Your chat ID is: ${chatId}`);
      return;
    }

    if (text === '/start' || text === '/help' || text === '/menu') {
      await sendMenu(
        chatId,
        'Browser automation bot ready.\n\n' +
        '🖥 Manual Session lets you inspect/control the hosted browser yourself.\n\n' +
        '/session_start - start manual browser\n' +
        '/surfshark_login - get Surfshark device login code\n' +
        '/connect_india - automatic India attempt\n' +
        '/surfshark_status - check browser IP/country\n' +
        '/run - run automation\n' +
        '/status - current bot status\n' +
        '/id - show your Telegram chat ID'
      );
      return;
    }

    if (text === '/id') {
      await sendMenu(chatId, `Your chat ID: ${chatId}`);
      return;
    }

    if (text === '/status') {
      const sessionInfo = manualSession.active ? await manualSession.info() : null;
      await sendMenu(
        chatId,
        `Status: ${running ? 'running' : lastStatus}` +
        `${lastRunAt ? `\nLast run: ${lastRunAt}` : ''}` +
        `${sessionInfo?.active ? `\nManual session: ACTIVE\nSession URL: ${sessionInfo.url || '(blank)'}` : '\nManual session: closed'}`
      );
      return;
    }

    // ---- Manual browser session commands ----
    if (text === '/session_start') {
      if (running) {
        await sendMessage(chatId, 'A browser job is already running. Wait for it to finish, then start the manual session.');
        return;
      }
      lastStatus = 'manual session active';
      await sendMessage(chatId, 'Starting persistent manual Chromium session…');
      await manualSession.start(chatId);
      await sendSessionMenu(chatId, manualHelpText());
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_close') {
      await manualSession.close(chatId);
      lastStatus = 'idle';
      await sendMenu(chatId, '✅ Manual browser session closed.');
      return;
    }

    if (text === '/session_surfshark') {
      await manualSession.openSurfshark(chatId);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_ipcheck') {
      await manualSession.openIpCheck(chatId);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_screenshot') {
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_grid') {
      await sendManualScreenshot(chatId, true);
      return;
    }

    if (text === '/session_scroll_up') {
      await manualSession.scroll(chatId, -650);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_scroll_down') {
      await manualSession.scroll(chatId, 650);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text === '/session_refresh') {
      await manualSession.refresh(chatId);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text.startsWith('/open ')) {
      const url = text.slice('/open '.length).trim();
      await manualSession.goto(chatId, url);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text.startsWith('/click ')) {
      const parts = text.slice('/click '.length).trim().split(/\s+/);
      await manualSession.click(chatId, parts[0], parts[1]);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text.startsWith('/type ')) {
      const value = text.slice('/type '.length);
      await manualSession.type(chatId, value);
      await sendManualScreenshot(chatId, false);
      return;
    }

    if (text.startsWith('/key ')) {
      const key = text.slice('/key '.length).trim();
      await manualSession.press(chatId, key);
      await sendManualScreenshot(chatId, false);
      return;
    }

    const browserJobCommands = ['/surfshark_login', '/connect_india', '/surfshark_status', '/run'];
    if (browserJobCommands.includes(text) && manualSession.active) {
      await sendSessionMenu(chatId, 'A manual browser session is currently open. Close it with ❌ Close Session before running an automatic browser job.');
      return;
    }

    if (browserJobCommands.includes(text) && running) {
      await sendMessage(chatId, 'Another browser job is already running. Wait for it to finish.');
      return;
    }

    if (text === '/surfshark_status') {
      running = true;
      lastStatus = 'checking Surfshark';
      try {
        const vpn = await withBrowser(context => checkPublicIp(context, config.expectedCountry));
        await sendMessage(
          chatId,
          `${vpn.ok ? '✅' : '⚠️'} Browser VPN status\n` +
          `IP: ${vpn.ip}\nCountry: ${vpn.country}\nCity: ${vpn.city}\nProvider: ${vpn.org || 'unknown'}\n` +
          `India: ${vpn.ok ? 'YES' : 'NO'}\n` +
          `Checks: ${(vpn.checks || []).map(x => x.country ? `${x.provider}=${x.country}` : `${x.provider}=ERR`).join(', ') || 'n/a'}`
        );
        lastStatus = 'idle';
      } catch (error) {
        lastStatus = 'failed';
        console.error(error);
        await sendMessage(chatId, `❌ Surfshark status failed\n${error.message}`);
      } finally {
        running = false;
      }
      return;
    }

    if (text === '/surfshark_login') {
      running = true;
      lastStatus = 'waiting for Surfshark login';
      let context;
      try {
        ({ context } = await launchBrowser());
        const { page, code } = await requestLoginCode(context);
        await sendMessage(
          chatId,
          `🔐 Surfshark login code: ${code}\n\n` +
          'On a device where you are already signed in to Surfshark, open the account/device login-code screen and enter this code.\n\n' +
          'I will keep this browser open for up to 5 minutes while you approve it.'
        );

        const loggedIn = await waitForLogin(page);
        if (!loggedIn) {
          throw new Error('Timed out waiting for Surfshark login approval. Send /surfshark_login to get a new code.');
        }

        await sendMenu(chatId, '✅ Surfshark login completed. You can now use 🖥 Manual Session to inspect it yourself.');
        lastStatus = 'Surfshark logged in';
      } catch (error) {
        lastStatus = 'failed';
        console.error(error);
        await sendMenu(chatId, `❌ Surfshark login failed\n${error.message}`);
      } finally {
        if (context) await context.close().catch(() => {});
        running = false;
      }
      return;
    }

    if (text === '/connect_india') {
      running = true;
      lastStatus = 'connecting Surfshark to India';
      try {
        const vpn = await withBrowser(context => connectIndia(context));
        await sendMenu(
          chatId,
          `✅ Surfshark connected to India\n` +
          `Endpoint: ${vpn.endpoint || 'India'}\nIP: ${vpn.ip}\nCountry: ${vpn.country}\nCity: ${vpn.city}\n` +
          `Checks: ${(vpn.checks || []).map(x => x.country ? `${x.provider}=${x.country}` : `${x.provider}=ERR`).join(', ')}`
        );
        lastStatus = 'Surfshark India connected';
      } catch (error) {
        lastStatus = 'failed';
        console.error(error);
        await sendMenu(chatId, `❌ Connect India failed\n${error.message}`);
      } finally {
        running = false;
      }
      return;
    }

    if (text !== '/run') return;

    running = true;
    lastStatus = 'running';
    lastRunAt = new Date().toISOString();
    await sendMessage(chatId, 'Starting Chromium + extensions…');

    try {
      const output = await runAutomation();
      lastStatus = 'completed';

      await sendMessage(
        chatId,
        `✅ Completed\n` +
        `VPN: ${output.vpn.country} / ${output.vpn.city}\n` +
        `IP: ${output.vpn.ip}\n` +
        `Page: ${output.result.title}\n` +
        `URL: ${output.result.url}`
      );

      if (output.screenshotPath && fs.existsSync(output.screenshotPath)) {
        await sendPhoto(chatId, output.screenshotPath, 'Automation result');
        fs.unlink(output.screenshotPath, () => {});
      }
    } catch (error) {
      lastStatus = 'failed';
      console.error(error);
      await sendMessage(chatId, `❌ Automation failed\n${error.message}`);
    } finally {
      running = false;
    }
  } catch (error) {
    console.error('Telegram handler error:', error);
    if (!manualSession.active) {
      running = false;
      lastStatus = 'failed';
    }
    try {
      if (manualSession.belongsTo(chatId)) {
        await sendSessionMenu(chatId, `❌ Manual session command failed\n${error.message}`);
      } else {
        await sendMenu(chatId, `❌ Command failed\n${error.message}`);
      }
    } catch {}
  }
});

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`Listening on 0.0.0.0:${config.port}`);
  try {
    await setupWebhook();
  } catch (error) {
    console.error('Webhook setup failed:', error.message);
  }
});
