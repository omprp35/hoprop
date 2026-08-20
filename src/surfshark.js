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

async function extractLoginCode(page) {
  const text = await page.locator('body').innerText().catch(() => '');

  // Surfshark currently uses a 6-character alphanumeric code (for example R278LT),
  // not necessarily six digits. Prefer the code shown immediately after
  // "Enter this code:" to avoid matching unrelated six-character words.
  const labelled = text.match(/enter\s+this\s+code\s*:\s*([A-Z0-9]{6})/i);
  if (labelled) return labelled[1].toUpperCase();

  // Fallback: accept a standalone 6-character token only when it contains
  // at least one letter and at least one digit.
  const candidates = text.match(/\b[A-Z0-9]{6}\b/gi) || [];
  return candidates.find(code => /[A-Z]/i.test(code) && /\d/.test(code))?.toUpperCase() || null;
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
  let code = await extractLoginCode(page);
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
    code = await extractLoginCode(page);
    if (code) return { page, code };
    await sleep(500);
  }

  const body = await page.locator('body').innerText().catch(() => '');
  throw new Error(`Surfshark login code could not be extracted. Popup text: ${body.slice(0, 500)}`);
}

async function waitForLogin(page, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    const text = await page.locator('body').innerText().catch(() => '');
    const codeStillVisible = /enter\s+this\s+code\s*:\s*[A-Z0-9]{6}/i.test(text);
    const looksLoggedIn = /quick\s*connect|locations?|connected|disconnect|vpn/i.test(text) && !/log\s*in|sign\s*in/i.test(text);
    if (!codeStillVisible && looksLoggedIn) return true;
  }
  return false;
}

async function connectIndia(context) {
  const { page } = await openSurfsharkPopup(context);
  await sleep(800);

  // If the browser is already going through India, do nothing.
  let vpn = await checkPublicIp(context, config.expectedCountry).catch(() => null);
  if (vpn?.ok) return vpn;

  const body = await page.locator('body').innerText().catch(() => '');
  if (/log\s*in|sign\s*in/i.test(body) && !/connected\s+and\s+safe|disconnect|pause/i.test(body)) {
    throw new Error('Surfshark is not logged in. Send /surfshark_login first.');
  }

  // Surfshark 5.2.x dashboard: clicking the currently selected location card
  // (for example "Hong Kong / Fastest location") opens "Choose location".
  let openedChooser = false;
  const chooserTriggers = [
    /fastest\s+location/i,
    /nearest\s+country/i,
    /choose\s+location/i,
    /recently\s+used/i
  ];

  for (const pattern of chooserTriggers) {
    const candidates = page.locator('button, [role="button"], [tabindex="0"], div').filter({ hasText: pattern });
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const el = candidates.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const txt = (await el.innerText().catch(() => '')) || '';
      if (txt.length > 180) continue;
      await el.click({ timeout: 3000 }).catch(() => {});
      await sleep(700);
      const popupText = await page.locator('body').innerText().catch(() => '');
      if (/choose\s+location/i.test(popupText) && /search/i.test(popupText)) {
        openedChooser = true;
        break;
      }
    }
    if (openedChooser) break;
  }

  // Fallback: click a visible location-selection control near the Connect button.
  if (!openedChooser) {
    await clickByText(page, [/locations?/i, /all\s*locations/i]);
    await sleep(700);
    const popupText = await page.locator('body').innerText().catch(() => '');
    openedChooser = /choose\s+location/i.test(popupText) && /search/i.test(popupText);
  }

  if (!openedChooser) {
    const text = await page.locator('body').innerText().catch(() => '');
    throw new Error(`Could not open Surfshark location chooser. Popup text: ${text.slice(0, 700)}`);
  }

  // Search exactly for India. The current Surfshark UI uses an input with
  // placeholder "Search" in the Choose location modal.
  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i], input').filter({ visible: true }).first();
  if (!(await search.count().catch(() => 0))) {
    throw new Error('Surfshark location search box was not found.');
  }
  await search.fill('India');
  await sleep(900);

  // Click the exact "India" result, not another occurrence of the word India
  // elsewhere on the dashboard (the old generic matcher could select the wrong UI).
  const indiaTexts = page.getByText('India', { exact: true });
  const indiaCount = await indiaTexts.count().catch(() => 0);
  let clickedIndia = false;

  for (let i = 0; i < indiaCount; i += 1) {
    const india = indiaTexts.nth(i);
    if (!(await india.isVisible().catch(() => false))) continue;

    // Prefer the result inside the open chooser. Clicking the text itself works
    // in Surfshark 5.2.x and avoids accidentally selecting Indonesia.
    await india.click({ timeout: 5000 }).catch(() => {});
    await sleep(1200);
    clickedIndia = true;
    break;
  }

  if (!clickedIndia) {
    const text = await page.locator('body').innerText().catch(() => '');
    throw new Error(`India result was not found in Surfshark location chooser. Popup text: ${text.slice(0, 700)}`);
  }

  // In Surfshark 5.2.x selecting India normally begins connecting immediately.
  // If the dashboard returns but still shows a Connect button, press it once.
  for (let i = 0; i < 8; i += 1) {
    await sleep(700);
    const text = await page.locator('body').innerText().catch(() => '');
    if (/connected\s+and\s+safe/i.test(text) && /india/i.test(text)) break;
    if (/\bconnect\b/i.test(text) && !/connecting/i.test(text)) {
      const connectButton = page.getByRole('button', { name: /^connect$/i }).first();
      if (await connectButton.isVisible().catch(() => false)) {
        await connectButton.click().catch(() => {});
        break;
      }
    }
  }

  // Verify using actual browser traffic, not only Surfshark's UI text.
  for (let i = 0; i < 30; i += 1) {
    await sleep(2000);
    vpn = await checkPublicIp(context, config.expectedCountry).catch(() => null);
    if (vpn?.ok) return vpn;
  }

  if (!vpn) throw new Error('India was selected, but the browser IP could not be checked.');
  throw new Error(`Surfshark did not reach India. Current browser IP is ${vpn.ip} (${vpn.country}, ${vpn.city}).`);
}

module.exports = {
  openSurfsharkPopup,
  requestLoginCode,
  waitForLogin,
  connectIndia
};
