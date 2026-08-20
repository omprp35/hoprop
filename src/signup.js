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
  let success = false;

  try {
    await fillEmail(popup, email);

    // Your extension currently uses a combined button labelled
    // "Apply & Claim 30 Days". Support both word orders as well as
    // older separate Claim / Apply UIs.
    const combinedCandidates = [
      popup.getByRole('button', { name: /apply\s*(?:&|and)?\s*claim(?:\s*30\s*days)?/i }),
      popup.getByRole('button', { name: /claim\s*(?:&|and)?\s*apply/i }),
      popup.locator('button').filter({ hasText: /apply\s*(?:&|and)?\s*claim/i }),
      popup.locator('button').filter({ hasText: /claim\s*(?:&|and)?\s*apply/i }),
      popup.getByText(/apply\s*(?:&|and)?\s*claim\s*30\s*days/i)
    ];

    let clickedCombined = false;
    for (const candidate of combinedCandidates) {
      try {
        const button = candidate.first();
        await button.waitFor({ state: 'visible', timeout: 2500 });
        await button.scrollIntoViewIfNeeded().catch(() => {});

        // Start waiting BEFORE the click so a very fast new tab is not missed.
        const pagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
        await button.click({ timeout: 7000 });
        clickedCombined = true;

        const opened = await pagePromise;
        if (opened) {
          await opened.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          if (/netflix\.com/i.test(opened.url())) {
            success = true;
            return opened;
          }
        }
        break;
      } catch {}
    }

    if (!clickedCombined) {
      // Older extension versions may expose separate Claim and Apply controls.
      await clickFirst([
        popup.getByRole('button', { name: /^claim$/i }),
        popup.getByText(/^claim$/i)
      ]);

      await popup.waitForTimeout(500);

      const pagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await clickFirst([
        popup.getByRole('button', { name: /^apply$/i }),
        popup.getByText(/^apply$/i)
      ]);
      const opened = await pagePromise;
      if (opened) {
        await opened.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        if (/netflix\.com/i.test(opened.url())) {
          success = true;
          return opened;
        }
      }
    }

    // Some extensions open the tab without firing Playwright's page event in
    // time, so also inspect every newly-created page for up to 20 seconds.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const netflixPage = context.pages().find(
        p => !pagesBefore.has(p) && /netflix\.com/i.test(p.url())
      );
      if (netflixPage) {
        await netflixPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        success = true;
        return netflixPage;
      }
      await popup.waitForTimeout(400);
    }

    throw new Error(
      'Clicked the extension action, but no Netflix tab opened within 20 seconds. ' +
      'The extension tab has been left open so you can inspect it in Live Desktop.'
    );
  } catch (error) {
    // Keep the extension page open on failure. This makes debugging through
    // Live Desktop possible instead of hiding the failed UI immediately.
    throw error;
  } finally {
    if (success) {
      await popup.close().catch(() => {});
    }
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
