const config = require('./config');

const API = `https://api.telegram.org/bot${config.botToken}`;

const MAIN_KEYBOARD = {
  keyboard: [
    [
      { text: '🖥 Manual Session' },
      { text: '🔐 Surfshark Login' }
    ],
    [
      { text: '🇮🇳 Connect India' },
      { text: '🌍 VPN Status' }
    ],
    [
      { text: '▶️ Run Automation' },
      { text: '📊 Bot Status' }
    ],
    [
      { text: '🆔 My ID' }
    ]
  ],
  resize_keyboard: true,
  is_persistent: true
};

const SESSION_KEYBOARD = {
  keyboard: [
    [
      { text: '🦈 Open Surfshark' },
      { text: '🌐 Open IP Check' }
    ],
    [
      { text: '📸 Screenshot' },
      { text: '🧭 Coordinate Grid' }
    ],
    [
      { text: '⬆️ Scroll Up' },
      { text: '⬇️ Scroll Down' }
    ],
    [
      { text: '🔄 Refresh' },
      { text: '❌ Close Session' }
    ],
    [
      { text: '🏠 Main Menu' }
    ]
  ],
  resize_keyboard: true,
  is_persistent: true
};

async function telegram(method, payload = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.status}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, options = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...options
  });
}

async function sendMenu(chatId, text) {
  return sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

async function sendSessionMenu(chatId, text) {
  return sendMessage(chatId, text, { reply_markup: SESSION_KEYBOARD });
}

async function sendPhoto(chatId, filePath, caption = '') {
  const fs = require('fs');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  const bytes = await fs.promises.readFile(filePath);
  form.append('photo', new Blob([bytes]), 'result.png');

  const response = await fetch(`${API}/sendPhoto`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram sendPhoto failed: ${data.description || response.status}`);
  return data.result;
}

async function setupWebhook() {
  if (!config.publicUrl) {
    console.log('PUBLIC_URL is empty; skipping Telegram webhook setup.');
    return;
  }

  const webhookUrl = `${config.publicUrl}/telegram`;
  const result = await telegram('setWebhook', {
    url: webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ['message']
  });
  console.log('Telegram webhook configured:', result, webhookUrl);
}

module.exports = { telegram, sendMessage, sendMenu, sendSessionMenu, sendPhoto, setupWebhook, MAIN_KEYBOARD, SESSION_KEYBOARD };
