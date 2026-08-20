const express = require('express');
const fs = require('fs');
const config = require('./config');
const { sendMessage, sendPhoto, setupWebhook } = require('./telegram');
const { runAutomation, launchBrowser } = require('./automation');
const { checkPublicIp } = require('./vpn-check');
const { requestLoginCode, waitForLogin, connectIndia } = require('./surfshark');

const app = express();
app.use(express.json({ limit: '1mb' }));

let running = false;
let lastStatus = 'idle';
let lastRunAt = null;

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

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-browser-automation',
    status: running ? 'running' : lastStatus,
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
  const text = message?.text?.trim();
  if (!chatId || !text) return;

  try {
    if (!isAuthorized(chatId)) {
      await sendMessage(chatId, `Not authorized. Your chat ID is: ${chatId}`);
      return;
    }

    if (text === '/start' || text === '/help') {
      await sendMessage(
        chatId,
        'Browser automation bot ready.\n\n' +
        '/surfshark_login - get Surfshark device login code\n' +
        '/connect_india - connect Surfshark to India\n' +
        '/surfshark_status - check browser IP/country\n' +
        '/run - run automation\n' +
        '/status - current bot status\n' +
        '/id - show your Telegram chat ID'
      );
      return;
    }

    if (text === '/id') {
      await sendMessage(chatId, `Your chat ID: ${chatId}`);
      return;
    }

    if (text === '/status') {
      await sendMessage(chatId, `Status: ${running ? 'running' : lastStatus}${lastRunAt ? `\nLast run: ${lastRunAt}` : ''}`);
      return;
    }

    if (['/surfshark_login', '/connect_india', '/surfshark_status', '/run'].includes(text) && running) {
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
          `India: ${vpn.ok ? 'YES' : 'NO'}`
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

        await sendMessage(chatId, '✅ Surfshark login completed. Now send /connect_india.');
        lastStatus = 'Surfshark logged in';
      } catch (error) {
        lastStatus = 'failed';
        console.error(error);
        await sendMessage(chatId, `❌ Surfshark login failed\n${error.message}`);
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
        await sendMessage(
          chatId,
          `✅ Surfshark connected to India\nIP: ${vpn.ip}\nCountry: ${vpn.country}\nCity: ${vpn.city}`
        );
        lastStatus = 'Surfshark India connected';
      } catch (error) {
        lastStatus = 'failed';
        console.error(error);
        await sendMessage(chatId, `❌ Connect India failed\n${error.message}`);
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
    running = false;
    lastStatus = 'failed';
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
