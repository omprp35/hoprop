const fs = require('fs');
const path = require('path');
const config = require('./config');
const { checkPublicIp } = require('./vpn-check');

const OFFICIAL_SURFSHARK_ID = 'ailoabdmgclmfmhdagmlohpjlbpffblp';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readSurfsharkManifest() {
  const manifestPath = path.join(config.surfsharkExtensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Surfshark manifest not found at ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function getPopupPath() {
  const manifest = readSurfsharkManifest();
  return manifest.action?.default_popup || manifest.browser_action?.default_popup || 'popup.html';
}

async function discoverExtensionIds(context) {
  const ids = new Set([OFFICIAL_SURFSHARK_ID]);

  // MV3 extensions expose service workers. Wait briefly for them to start.
  for (let i = 0; i < 20; i += 1) {
    for (const worker of context.serviceWorkers()) {
      const match = worker.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
      if (match) ids.add(match[1]);
    }
    if (ids.size > 1 || context.serviceWorkers().length) break;
    await sleep(250);
  }

  // MV2 fallback.
  if (typeof context.backgroundPages === 'function') {
    for (const page of context.backgroundPages()) {
      const match = page.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
      if (match) ids.add(match[1]);
    }
  }

  return [...ids];
}

async function openSurfsharkPopup(context) {
  const popupPath = getPopupPath();
  const ids = await discoverExtensionIds(context);
  let lastError;

  for (const id of ids) {
    const page = await context.newPage();
    try {
      await page.goto(`chrome-extension://${id}/${popupPath}`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000
      });
      await sleep(700);
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      const title = await page.title().catch(() => '');

      if (/surfshark/i.test(`${title}\n${body}`) || id === OFFICIAL_SURFSHARK_ID) {
        return { page, extensionId: id, popupPath };
      }
    } catch (error) {
      lastError = error;
    }
    await page.close().catch(() => {});
  }

  throw new Error(`Could not open the Surfshark extension popup${lastError ? `: ${lastError.message}` : ''}`);
}

async function clickByText(page, patterns) {
  const selectors = ['button', 'a', '[role="button"]', '[tabindex="0"]'];
  for (const pattern of patterns) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    for (const selector of selectors) {
      const locator = page.locator(selector).filter({ hasText: re });
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 8); i += 1) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.click({ timeout: 5000 }).catch(() => {});
          await sleep(500);
          return true;
        }
      }
    }
  }
  return false;
}

async function extractSixDigitCode(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  const matches = [...text.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map(m => m[1]);
  return matches[0] || null;
}

async function requestLoginCode(context) {
  const { page } = await openSurfsharkPopup(context);

  // Surfshark wording can change. Try several common entry points without relying on one CSS selector.
  await clickByText(page, [
    /log\s*in\s*with\s*(a\s*)?code/i,
    /login\s*with\s*(a\s*)?code/i,
    /log\s*in\s*with\s*another\s*device/i,
    /use\s*(a\s*)?login\s*code/i,
    /login\s*code/i
  ]);

  // Sometimes "Log in" must be opened first.
  let code = await extractSixDigitCode(page);
  if (!code) {
    const clickedLogin = await clickByText(page, [/^log\s*in$/i, /^login$/i, /sign\s*in/i]);
    if (clickedLogin) {
      await clickByText(page, [
        /log\s*in\s*with\s*(a\s*)?code/i,
        /login\s*with\s*(a\s*)?code/i,
        /another\s*device/i,
        /login\s*code/i
      ]);
    }
  }

  for (let i = 0; i < 30; i += 1) {
    code = await extractSixDigitCode(page);
    if (code) return { page, code };
    await sleep(500);
  }

  const body = await page.locator('body').innerText().catch(() => '');
  throw new Error(`Surfshark login-code screen was not found. Popup text: ${body.slice(0, 500)}`);
}

async function waitForLogin(page, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    const text = await page.locator('body').innerText().catch(() => '');
    const codeStillVisible = /(?:^|\D)\d{6}(?!\d)/.test(text);
    const looksLoggedIn = /quick\s*connect|locations?|connected|disconnect|vpn/i.test(text) && !/log\s*in|sign\s*in/i.test(text);
    if (!codeStillVisible && looksLoggedIn) return true;
  }
  return false;
}

async function connectIndia(context) {
  const { page } = await openSurfsharkPopup(context);
  await sleep(700);

  const body = await page.locator('body').innerText().catch(() => '');
  if (/log\s*in|sign\s*in/i.test(body) && !/disconnect|connected/i.test(body)) {
    throw new Error('Surfshark is not logged in. Send /surfshark_login first.');
  }

  // Try the Locations area first.
  await clickByText(page, [/locations?/i, /all\s*locations/i]);

  const searchInputs = page.locator('input');
  const count = await searchInputs.count().catch(() => 0);
  let filled = false;
  for (let i = 0; i < count; i += 1) {
    const input = searchInputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    const placeholder = await input.getAttribute('placeholder').catch(() => '');
    const aria = await input.getAttribute('aria-label').catch(() => '');
    if (/search|location/i.test(`${placeholder} ${aria}`) || !filled) {
      await input.fill('India').catch(() => {});
      filled = true;
      await sleep(700);
      if (/search|location/i.test(`${placeholder} ${aria}`)) break;
    }
  }

  const clicked = await clickByText(page, [/^india$/i, /india/i]);
  if (!clicked) {
    const text = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Could not find India in Surfshark popup. Popup text: ${text.slice(0, 500)}`);
  }

  // Give Surfshark time to establish the tunnel and verify through browser traffic.
  let vpn = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(1500);
    vpn = await checkPublicIp(context, config.expectedCountry).catch(() => null);
    if (vpn?.ok) return vpn;
  }

  if (!vpn) throw new Error('Connected action was sent, but the browser IP could not be checked.');
  throw new Error(`Surfshark did not reach India. Current browser IP is ${vpn.ip} (${vpn.country}, ${vpn.city}).`);
}

module.exports = {
  openSurfsharkPopup,
  requestLoginCode,
  waitForLogin,
  connectIndia
};
