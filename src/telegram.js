const config = require('./config');

const API = `https://api.telegram.org/bot${config.botToken}`;

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

async function sendMessage(chatId, text) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
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

module.exports = { telegram, sendMessage, sendPhoto, setupWebhook };
