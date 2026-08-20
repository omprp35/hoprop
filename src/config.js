const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cleanUrl(value) {
  return value ? value.replace(/\/+$/, '') : '';
}

module.exports = {
  port: Number(process.env.APP_PORT || 10001),
  botToken: required('TELEGRAM_BOT_TOKEN'),
  webhookSecret: required('TELEGRAM_WEBHOOK_SECRET'),
  publicUrl: cleanUrl(process.env.PUBLIC_URL || ''),
  profileDir: process.env.PROFILE_DIR || '/data/browser-profile',
  customExtensionDir: process.env.CUSTOM_EXTENSION_DIR || path.join(process.cwd(), 'extensions/custom'),
  surfsharkExtensionDir: process.env.SURFSHARK_EXTENSION_DIR || path.join(process.cwd(), 'extensions/surfshark'),
  authorizedChatIds: new Set(
    (process.env.AUTHORIZED_CHAT_IDS || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  )
};
