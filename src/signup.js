const { getInstalledExtensions } = require('./extensions');
const config = require('./config');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function clickFirst(candidates, timeout = 12000) {
  let lastError;
  for (const locator of candidates) {
    try {
      await locator.first().waitFor({ state: 'visible', timeout: Math.min(timeout, 5000) });
      await locator.first().click({ timeout: 5000 });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function fillEmail(page, email) {
  const candidates = [
    page.getByRole('textbox', { name: /email/i }),
    page.locator('input[type="email"]'),
    page.locator('input[name*="email" i]'),
    page.locator('input[placeholder*="email" i]'),
    page.locator('input[autocomplete="email"]')
  ];

  for (const locator of candidates) {
    try {
      const input = locator.first();
      await input.waitFor({ state: 'visible', timeout: 4000 });
      await input.fill(email);
      return;
    } catch {}
  }
  throw new Error(`Could not find an email field on: ${page.url()}`);
}

async function verifyIndia(context) {
  const page = await context.newPage();
  try {
    const services = [
      {
        name: 'country.is',
        url: 'https://api.country.is/',
        parse: body => {
          const j = JSON.parse(body);
          return { country: j.country, ip: j.ip || '?' };
        }
      },
      {
        name: 'ipapi',
        url: 'https://ipapi.co/json/',
        parse: body => {
          const j = JSON.parse(body);
          return { country: j.country_code, ip: j.ip || '?' };
        }
      }
    ];

    const results = [];
    for (const svc of services) {
      try {
        await page.goto(svc.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const body = await page.locator('body').innerText();
        results.push({ service: svc.name, ...svc.parse(body) });
      } catch (error) {
        results.push({ service: svc.name, country: 'ERR', ip: '?', error: error.message });
      }
    }

    const india = results.find(r => String(r.country).toUpperCase() === 'IN');
    if (!india) {
      const summary = results.map(r => `${r.service}=${r.country}/${r.ip}`).join(', ');
      throw new Error(`Browser location is not verified as India. ${summary}. Open Live Desktop, connect Surfshark to India manually, then start again.`);
    }

    return { ok: true, results, ip: india.ip };
  } finally {
    await page.close().catch(() => {});
  }
}

async function openCustomExtensionPopup(browser) {
  const context = await browser.ensure();
  const custom = getInstalledExtensions(config).find(x => x.label === 'custom');
  if (!custom) throw new Error('Custom extension is not installed in extensions/custom/.');
  if (!custom.popup) throw new Error('Custom extension manifest has no action.default_popup/browser_action.default_popup.');

  const extensionId = await browser.resolveExtensionId(custom);
  if (!extensionId) {
    throw new Error('Could not determine the custom extension ID. Open Live Desktop once, then retry so Chromium can initialize the extension profile.');
  }

  const popupPath = String(custom.popup).replace(/^\/+/, '');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${popupPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return page;
}

async function claimAndApply(browser, email) {
  const context = await browser.ensure();
  const popup = await openCustomExtensionPopup(browser);
  const pagesBefore = new Set(context.pages());

  try {
    await fillEmail(popup, email);

    // Support either one combined button or separate Claim then Apply buttons.
    const combined = popup.getByRole('button', { name: /claim\s*(?:&|and)?\s*apply/i });
    if (await combined.count()) {
      await combined.first().click();
    } else {
      await clickFirst([
        popup.getByRole('button', { name: /^claim$/i }),
        popup.getByText(/^claim$/i)
      ]);

      // Give the extension a moment to update after Claim.
      await popup.waitForTimeout(500);

      const pagePromise = context.waitForEvent('page', { timeout: 12000 }).catch(() => null);
      await clickFirst([
        popup.getByRole('button', { name: /^apply$/i }),
        popup.getByText(/^apply$/i)
      ]);
      const opened = await pagePromise;
      if (opened) {
        await opened.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        return opened;
      }
    }

    // A combined Claim/Apply button may also open a new tab.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const netflixPage = context.pages().find(p => !pagesBefore.has(p) && /netflix\.com/i.test(p.url()));
      if (netflixPage) return netflixPage;
      await popup.waitForTimeout(500);
    }

    throw new Error('The extension action completed, but no Netflix tab opened.');
  } finally {
    await popup.close().catch(() => {});
  }
}

async function netflixStartAndSendLink(page, email) {
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

  await fillEmail(page, email);

  await clickFirst([
    page.getByRole('button', { name: /get started/i }),
    page.getByRole('link', { name: /get started/i }),
    page.getByText(/get started/i)
  ]);

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

  await clickFirst([
    page.getByRole('button', { name: /send link/i }),
    page.getByRole('link', { name: /send link/i }),
    page.getByText(/send link/i)
  ], 15000);

  return { pageUrl: page.url() };
}

function validateNetflixLink(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('That is not a valid URL. Paste the full Netflix link from your email.');
  }

  const host = url.hostname.toLowerCase();
  if (!(host === 'netflix.com' || host.endsWith('.netflix.com'))) {
    throw new Error(`Expected a Netflix link, but received ${host}.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error('Netflix signup link must use HTTPS.');
  }
  return url.toString();
}

async function finishSignup(browser, link) {
  const context = await browser.ensure();
  const url = validateNetflixLink(link);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await clickFirst([
    page.getByRole('button', { name: /finish\s*sign\s*up/i }),
    page.getByRole('link', { name: /finish\s*sign\s*up/i }),
    page.getByText(/finish\s*sign\s*up/i)
  ], 20000);

  return { url: page.url(), title: normalizeText(await page.title()) };
}

module.exports = {
  verifyIndia,
  claimAndApply,
  netflixStartAndSendLink,
  finishSignup,
  validateNetflixLink
};
