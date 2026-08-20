const express = require('express');
const fs = require('fs');
const config = require('./config');
const { sendMessage, sendPhoto, setupWebhook } = require('./telegram');
const { runAutomation } = require('./automation');

const app = express();
app.use(express.json({ limit: '1mb' }));

let running = false;
let lastStatus = 'idle';
let lastRunAt = null;

function isAuthorized(chatId) {
  return config.authorizedChatIds.size === 0 || config.authorizedChatIds.has(String(chatId));
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

  // Telegram should receive a fast response. The actual job continues in this Render process.
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
        'Browser automation bot ready.\n\n/run - run automation\n/status - current status\n/id - show your Telegram chat ID'
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

    if (text !== '/run') return;

    if (running) {
      await sendMessage(chatId, 'An automation job is already running.');
      return;
    }

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
