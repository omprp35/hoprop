const config = require('./config');

const API = `https://api.telegram.org/bot${config.botToken}`;

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '▶️ Start Signup' }, { text: '🖥 Live Desktop' }],
    [{ text: '🔄 Restart Browser' }, { text: '❌ Close Browser' }],
    [{ text: '🛑 Cancel Signup' }]
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

async function setupWebhook() {
  if (!config.publicUrl) {
    console.log('PUBLIC_URL is empty; skipping Telegram webhook setup.');
    return;
  }

  const url = `${config.publicUrl}/telegram`;
  const result = await telegram('setWebhook', {
    url,
    secret_token: config.webhookSecret,
    allowed_updates: ['message']
  });
  console.log('Telegram webhook configured:', result, url);
}

module.exports = { sendMessage, sendMenu, setupWebhook };
