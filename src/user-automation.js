/**
 * Put YOUR website automation in this function.
 *
 * You receive a normal Playwright Page and Context.
 * The VPN check has already run before this function is called.
 */
async function runUserAutomation({ page, context, targetUrl }) {
  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  // ---------------- EXAMPLES ----------------
  // await page.fill('input[type="email"]', 'your@example.com');
  // await page.click('button[type="submit"]');
  // await page.waitForLoadState('networkidle');
  // ------------------------------------------

  return {
    title: await page.title(),
    url: page.url()
  };
}

module.exports = { runUserAutomation };
