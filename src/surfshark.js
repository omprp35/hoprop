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

async function chooserIsOpen(page) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (!/choose\s+location/i.test(text)) return false;
  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i], input').first();
  return await search.isVisible().catch(() => false);
}

async function openLocationChooser(page) {
  if (await chooserIsOpen(page)) return true;

  // 1) Prefer explicit accessible controls if Surfshark exposes them.
  const explicit = page.locator([
    'button[aria-label*="location" i]',
    '[role="button"][aria-label*="location" i]',
    'button[title*="location" i]',
    '[role="button"][title*="location" i]',
    'button[aria-label*="server" i]',
    '[role="button"][aria-label*="server" i]'
  ].join(','));

  const explicitCount = await explicit.count().catch(() => 0);
  for (let i = 0; i < Math.min(explicitCount, 20); i += 1) {
    const el = explicit.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ force: true, timeout: 3000 }).catch(() => {});
    await sleep(700);
    if (await chooserIsOpen(page)) return true;
  }

  // 2) Surfshark 5.2.x layout shown in the hosted browser:
  // the current-location card is immediately above the Pause/Connect row and
  // the small list icon is near the card's right edge. Anchor from the visible
  // "Recently used" and Pause/Connect controls, then click that icon area.
  const recent = page.getByText(/recently\s+used/i).first();
  const recentBox = await recent.boundingBox().catch(() => null);
  const action = page.getByRole('button', { name: /^(pause|connect)$/i }).first();
  const actionBox = await action.boundingBox().catch(() => null);

  if (recentBox && actionBox) {
    const xCandidates = [
      recentBox.x + recentBox.width - 45,
      recentBox.x + recentBox.width - 70,
      actionBox.x + actionBox.width + 35
    ];
    const yCandidates = [
      actionBox.y - 55,
      actionBox.y - 70,
      actionBox.y - 40
    ];

    for (const y of yCandidates) {
      for (const x of xCandidates) {
        await page.mouse.click(x, y).catch(() => {});
        await sleep(700);
        if (await chooserIsOpen(page)) return true;
      }
    }
  }

  // 3) DOM fallback: inspect clickable elements directly above "Recently used".
  if (recentBox) {
    const candidates = page.locator('button, [role="button"], [tabindex="0"]');
    const count = await candidates.count().catch(() => 0);
    const ranked = [];

    for (let i = 0; i < Math.min(count, 160); i += 1) {
      const el = candidates.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;

      const bottom = box.y + box.height;
      const gap = recentBox.y - bottom;
      const overlaps = box.x < recentBox.x + recentBox.width && box.x + box.width > recentBox.x;
      const text = ((await el.innerText().catch(() => '')) || '').trim();

      if (gap >= 0 && gap < 260 && overlaps && box.width >= 120) {
        if (/^(pause|connect|turn on|off|on)$/i.test(text)) continue;
        ranked.push({ el, gap, box, text });
      }
    }

    ranked.sort((a, b) => a.gap - b.gap);
    for (const candidate of ranked.slice(0, 12)) {
      // Click near the right edge first because that is where Surfshark's list
      // icon is located. Fall back to clicking the element itself.
      await page.mouse.click(
        candidate.box.x + candidate.box.width - 28,
        candidate.box.y + candidate.box.height / 2
      ).catch(() => {});
      await sleep(600);
      if (await chooserIsOpen(page)) return true;

      await candidate.el.click({ force: true, timeout: 2500 }).catch(() => {});
      await sleep(600);
      if (await chooserIsOpen(page)) return true;
    }
  }

  // 4) Older Surfshark layouts.
  await clickByText(page, [/choose\s+location/i, /locations?/i, /all\s*locations/i]);
  await sleep(700);
  return chooserIsOpen(page);
}

async function bodyText(page) {
  return await page.locator('body').innerText().catch(() => '');
}

async function isConnected(page) {
  const text = await bodyText(page);
  return /connected\s+and\s+safe/i.test(text) || /vpn\s+ip\s+address/i.test(text) && /\bpause\b/i.test(text);
}

async function forceDisconnect(page) {
  if (!(await isConnected(page))) return true;

  // Surfshark 5.2.x: the power/disconnect icon is the small button immediately
  // to the right of the Pause button. Find it geometrically so we do not depend
  // on an aria-label that Surfshark may change.
  const pause = page.getByRole('button', { name: /^pause$/i }).first();
  const pauseBox = await pause.boundingBox().catch(() => null);

  if (pauseBox) {
    const buttons = page.locator('button');
    const count = await buttons.count().catch(() => 0);
    const candidates = [];
    const pauseCenterY = pauseBox.y + pauseBox.height / 2;

    for (let i = 0; i < Math.min(count, 120); i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;
      const box = await button.boundingBox().catch(() => null);
      if (!box) continue;
      const centerY = box.y + box.height / 2;
      const text = ((await button.innerText().catch(() => '')) || '').trim();
      if (Math.abs(centerY - pauseCenterY) > 35) continue;
      if (box.x <= pauseBox.x + pauseBox.width - 4) continue;
      if (box.x - (pauseBox.x + pauseBox.width) > 140) continue;
      if (/pause|connect|turn on/i.test(text)) continue;
      candidates.push({ button, box, distance: box.x - (pauseBox.x + pauseBox.width) });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates.length) {
      await candidates[0].button.click({ force: true, timeout: 3000 }).catch(() => {});
    } else {
      // Exact layout fallback: click the center of the square power control.
      await page.mouse.click(
        pauseBox.x + pauseBox.width + 35,
        pauseBox.y + pauseBox.height / 2
      ).catch(() => {});
    }
  }

  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    const text = await bodyText(page);
    if (!/connected\s+and\s+safe/i.test(text) && !/\bpause\b/i.test(text)) return true;
    const connect = page.getByRole('button', { name: /^connect$/i }).first();
    if (await connect.isVisible().catch(() => false)) return true;
  }

  return false;
}

async function clickLocationResult(page, label) {
  // Search results use nested React nodes, so click the visible exact text node.
  const nodes = page.locator(`xpath=//*[normalize-space(text())="${label}"]`);
  const count = await nodes.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 40); i += 1) {
    const node = nodes.nth(i);
    if (!(await node.isVisible().catch(() => false))) continue;
    const box = await node.boundingBox().catch(() => null);
    if (!box) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    await sleep(900);
    return true;
  }
  return false;
}

async function selectIndiaEndpoint(page, endpoint) {
  const opened = await openLocationChooser(page);
  if (!opened) return { ok: false, reason: 'location chooser did not open' };

  const search = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i], input').first();
  if (!(await search.isVisible().catch(() => false))) {
    return { ok: false, reason: 'location search box not found' };
  }

  await search.fill('india');
  await sleep(900);

  const clicked = await clickLocationResult(page, endpoint);
  if (!clicked) {
    return { ok: false, reason: `${endpoint} result not found`, text: await bodyText(page) };
  }

  // Wait for chooser to close / dashboard to return.
  for (let i = 0; i < 16; i += 1) {
    await sleep(500);
    if (!(await chooserIsOpen(page))) break;
  }

  return { ok: true };
}

function formatChecks(vpn) {
  if (!vpn?.checks) return '';
  return vpn.checks
    .map(x => x.country ? `${x.provider}=${x.country}/${x.ip}` : `${x.provider}=ERR`)
    .join(', ');
}

async function verifyIndia(context, tries = 3) {
  let vpn = null;
  for (let i = 0; i < tries; i += 1) {
    await sleep(1800);
    vpn = await checkPublicIp(context, config.expectedCountry).catch(() => null);
    if (vpn?.ok) return vpn;
  }
  return vpn;
}

async function connectIndia(context) {
  const { page } = await openSurfsharkPopup(context);
  await sleep(900);

  // If already verified as India, do not disturb a good tunnel.
  let vpn = await checkPublicIp(context, config.expectedCountry).catch(() => null);
  if (vpn?.ok) return vpn;

  const initialBody = await bodyText(page);
  if (/log\s*in|sign\s*in/i.test(initialBody) && !/connected\s+and\s+safe|pause|vpn\s+ip\s+address/i.test(initialBody)) {
    throw new Error('Surfshark is not logged in. Use the Surfshark Login button first.');
  }

  // IMPORTANT: selecting an India card while an old tunnel is still connected can
  // leave Surfshark showing "India / Mumbai" while traffic continues through the
  // previous GB/SG endpoint. Always start each endpoint attempt from DISCONNECTED.
  const endpoints = ['Mumbai', 'Delhi', 'India'];
  const attempts = [];

  for (const endpoint of endpoints) {
    const disconnected = await forceDisconnect(page);
    if (!disconnected) {
      throw new Error('Could not cleanly disconnect the previous Surfshark tunnel. The bot stopped instead of risking the wrong country.');
    }

    await sleep(700);
    const selected = await selectIndiaEndpoint(page, endpoint);
    if (!selected.ok) {
      attempts.push(`${endpoint}: ${selected.reason}`);
      continue;
    }

    // Some Surfshark builds connect immediately when a location row is clicked.
    // If not, only now press the dashboard Connect button.
    let connected = await isConnected(page);
    if (!connected) {
      const connectButton = page.getByRole('button', { name: /^connect$/i }).first();
      if (await connectButton.isVisible().catch(() => false)) {
        await connectButton.click({ force: true, timeout: 4000 }).catch(() => {});
      }

      for (let i = 0; i < 24; i += 1) {
        await sleep(500);
        connected = await isConnected(page);
        if (connected) break;
      }
    }

    if (!connected) {
      attempts.push(`${endpoint}: did not enter Connected state`);
      continue;
    }

    // Let the browser proxy settle, then verify with THREE independent services.
    vpn = await verifyIndia(context, 2);
    if (vpn?.ok) {
      console.log(`Surfshark India verified via ${endpoint}: ${formatChecks(vpn)}`);
      return { ...vpn, endpoint };
    }

    attempts.push(`${endpoint}: ${formatChecks(vpn) || 'IP verification failed'}`);
    console.warn(`Surfshark ${endpoint} did not verify as India; rotating endpoint. ${formatChecks(vpn)}`);
  }

  const finalUi = await bodyText(page);
  throw new Error(
    'Surfshark could not obtain an IP that geolocation services agree is India. ' +
    `Tried Mumbai, Delhi, and India/Fastest automatically. ${attempts.join(' | ')}. ` +
    `Surfshark UI: ${finalUi.slice(0, 500)}`
  );
}

module.exports = {
  openSurfsharkPopup,
  requestLoginCode,
  waitForLogin,
  connectIndia
};
