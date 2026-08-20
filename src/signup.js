const { getInstalledExtensions } = require('./extensions');
const config = require('./config');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function clickFirst(candidates, timeout = 12000) {
  let lastError;
  for (const locator of candidates) {
    try {
      const target = locator.first();
      await target.waitFor({ state: 'visible', timeout: Math.min(timeout, 5000) });
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ timeout: 5000 });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function tryClickFirst(candidates, timeout = 3000) {
  for (const locator of candidates) {
    try {
      const target = locator.first();
      await target.waitFor({ state: 'visible', timeout });
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ timeout });
      return true;
    } catch {}
  }
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
  } finally {
    if (success) {
      await popup.close().catch(() => {});
    }
  }
}

async function dismissNetflixCookieBanner(page) {
  // Netflix's banner can cover the signup controls. Prefer Reject, then close/Accept.
  const directSelectors = [
    'button:has-text("Reject")',
    'button:has-text("Reject All")',
    'button:has-text("Accept")'
  ];

  for (const selector of directSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click({ timeout: 4000 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch {}
  }

  return tryClickFirst([
    page.getByRole('button', { name: /^reject$/i }),
    page.getByRole('button', { name: /reject all/i }),
    page.getByRole('button', { name: /^accept$/i }),
    page.getByText(/^reject$/i),
    page.getByText(/^accept$/i)
  ], 1500);
}

async function resolveNetflixPage(page) {
  const context = page.context();
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    const pages = context.pages().filter(p => !p.isClosed());
    const netflixPages = pages.filter(p => /(^|\.)netflix\.com/i.test(new URL(p.url(), 'https://netflix.com').hostname));

    if (netflixPages.length) {
      // Prefer the originally returned page when it really is the Netflix page.
      if (!page.isClosed() && /netflix\.com/i.test(page.url())) return page;
      return netflixPages[netflixPages.length - 1];
    }

    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error('Netflix tab opened visually, but Playwright could not resolve a live netflix.com page in this browser context.');
}

async function clickNetflixPrimaryCta(page) {
  const candidates = [
    page.getByRole('button', { name: /try\s*30\s*days\s*for\s*(?:₹|rs\.?|inr)?\s*0/i }),
    page.getByRole('link', { name: /try\s*30\s*days\s*for\s*(?:₹|rs\.?|inr)?\s*0/i }),
    page.getByText(/try\s*30\s*days\s*for\s*(?:₹|rs\.?|inr)?\s*0/i),
    page.getByRole('button', { name: /get started/i }),
    page.getByRole('link', { name: /get started/i }),
    page.getByRole('button', { name: /continue/i }),
    page.getByRole('link', { name: /continue/i }),
    page.locator('button[type="submit"]').filter({ hasText: /try|get started|continue|start/i })
  ];

  return clickFirst(candidates, 15000);
}

async function clickSendLink(page) {
  const sendCandidates = [
    page.getByRole('button', { name: /send\s*(?:me\s*)?(?:the\s*)?link/i }),
    page.getByRole('link', { name: /send\s*(?:me\s*)?(?:the\s*)?link/i }),
    page.getByText(/send\s*(?:me\s*)?(?:the\s*)?link/i),
    page.getByRole('button', { name: /email\s*(?:me\s*)?(?:a\s*)?link/i }),
    page.getByRole('button', { name: /send\s*(?:email|mail)/i })
  ];

  for (let i = 0; i < 12; i++) {
    if (await tryClickFirst(sendCandidates, 1200)) return true;
    await dismissNetflixCookieBanner(page).catch(() => {});
    await page.waitForTimeout(700);
  }
  return false;
}

async function netflixStartAndSendLink(page, email, onProgress = async () => {}) {
  page = await resolveNetflixPage(page);
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});

  // Wait for Netflix's real homepage signup field, not merely for a tab to exist.
  const netflixEmail = page.locator('input[data-uia="field-email"]');
  await netflixEmail.waitFor({ state: 'visible', timeout: 25000 });

  await dismissNetflixCookieBanner(page).catch(() => {});
  await onProgress('Netflix page detected. Entering the email…');

  // Fill and verify. If React/browser state rejects fill(), type it normally.
  await netflixEmail.fill(email);
  let actual = await netflixEmail.inputValue().catch(() => '');
  if (actual.trim().toLowerCase() !== email.trim().toLowerCase()) {
    await netflixEmail.click({ timeout: 5000 });
    await netflixEmail.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await netflixEmail.pressSequentially(email, { delay: 25 });
    actual = await netflixEmail.inputValue().catch(() => '');
  }

  if (actual.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error(`Netflix email field was found, but the email was not entered. Field value is: ${actual || '(empty)'}`);
  }

  await onProgress('✅ Netflix email entered. Clicking Try 30 Days for ₹0…');

  // Exact selector supplied from the live Netflix page.
  const startButton = page.locator('button[data-uia="nmhp-card-cta+hero_card"]');
  await startButton.waitFor({ state: 'visible', timeout: 15000 });
  await startButton.scrollIntoViewIfNeeded().catch(() => {});

  if (!(await startButton.isEnabled().catch(() => true))) {
    throw new Error('Netflix signup button is visible but disabled after entering the email.');
  }

  await startButton.click({ timeout: 10000 });
  await onProgress('✅ Offer button clicked. Waiting for Send Link…');

  // Netflix is an SPA. Wait for the exact next-step selector instead of only navigation.
  const exactSendLink = page.locator('button[data-uia="email-register-send-link-send-link-button"]');
  let found = false;
  for (let i = 0; i < 25; i++) {
    await dismissNetflixCookieBanner(page).catch(() => {});
    if (await exactSendLink.isVisible().catch(() => false)) {
      found = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!found) {
    // Some variants insert one intermediate Continue/Get Started screen.
    const intermediateClicked = await tryClickFirst([
      page.getByRole('button', { name: /get started/i }),
      page.getByRole('link', { name: /get started/i }),
      page.getByRole('button', { name: /continue/i }),
      page.getByRole('link', { name: /continue/i }),
      page.getByRole('button', { name: /next/i })
    ], 2500);

    if (intermediateClicked) {
      for (let i = 0; i < 15; i++) {
        if (await exactSendLink.isVisible().catch(() => false)) {
          found = true;
          break;
        }
        await page.waitForTimeout(500);
      }
    }
  }

  if (!found) {
    let excerpt = '';
    try {
      excerpt = normalizeText(await page.locator('body').innerText()).slice(0, 1200);
    } catch {}
    throw new Error(
      `Netflix CTA was clicked, but the Send Link step did not appear. URL: ${page.url()}. ` +
      `Visible text: ${excerpt || '(unavailable)'}`
    );
  }

  await exactSendLink.scrollIntoViewIfNeeded().catch(() => {});
  await exactSendLink.click({ timeout: 10000 });
  await onProgress('✅ Send Link clicked.');

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
  await dismissNetflixCookieBanner(page).catch(() => {});

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
