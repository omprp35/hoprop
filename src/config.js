const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cleanUrl(value) {
  return value ? value.replace(/\/+$/, '') : '';
}

const config = {
  port: Number(process.env.APP_PORT || process.env.PORT || 10001),
  botToken: required('TELEGRAM_BOT_TOKEN'),
  publicUrl: cleanUrl(process.env.PUBLIC_URL || ''),
  webhookSecret: required('TELEGRAM_WEBHOOK_SECRET'),
  targetUrl: process.env.TARGET_URL || 'https://example.com',
  profileDir: process.env.PROFILE_DIR || '/tmp/browser-profile',
  customExtensionDir: process.env.CUSTOM_EXTENSION_DIR || path.join(process.cwd(), 'extensions/custom'),
  surfsharkExtensionDir: process.env.SURFSHARK_EXTENSION_DIR || path.join(process.cwd(), 'extensions/surfshark'),
  expectedCountry: (process.env.EXPECTED_COUNTRY || 'IN').toUpperCase(),
  authorizedChatIds: new Set(
    (process.env.AUTHORIZED_CHAT_IDS || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  )
};

module.exports = config;
