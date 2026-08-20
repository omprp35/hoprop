const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { existingExtensionDirs } = require('./extensions');
const { checkPublicIp } = require('./vpn-check');
const { runUserAutomation } = require('./user-automation');

async function launchBrowser() {
  fs.mkdirSync(config.profileDir, { recursive: true });

  const extensions = existingExtensionDirs(config);
  if (!extensions.length) {
    throw new Error('No unpacked Chrome extension found. Put manifest.json files in extensions/custom and extensions/surfshark.');
  }

  const extensionPaths = extensions.map(e => e.dir).join(',');
  console.log('Loading extensions:', extensions.map(e => `${e.name} ${e.version}`).join(' | '));

  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${extensionPaths}`,
      `--load-extension=${extensionPaths}`
    ]
  });

  return { context, extensions };
}

async function runAutomation() {
  let context;
  try {
    const launched = await launchBrowser();
    context = launched.context;

    // Give extension background/service workers time to initialize and auto-connect.
    await new Promise(resolve => setTimeout(resolve, 5000));

    const vpn = await checkPublicIp(context, config.expectedCountry);
    if (!vpn.ok) {
      const err = new Error(
        `VPN check failed. Expected ${config.expectedCountry}, got ${vpn.country} (${vpn.ip}, ${vpn.city}). ` +
        'Open/configure Surfshark in this profile and enable Auto-connect to India.'
      );
      err.vpn = vpn;
      throw err;
    }

    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    const result = await runUserAutomation({
      page,
      context,
      targetUrl: config.targetUrl
    });

    const screenshotPath = path.join('/tmp', `automation-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return { result, vpn, screenshotPath };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

module.exports = { runAutomation, launchBrowser };
