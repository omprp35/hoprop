async function checkPublicIp(context, expectedCountry = 'IN') {
  const page = await context.newPage();
  try {
    await page.goto('https://ipinfo.io/json', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const text = await page.locator('body').innerText();
    const info = JSON.parse(text);
    const country = String(info.country || '').toUpperCase();

    return {
      ok: country === expectedCountry.toUpperCase(),
      ip: info.ip || 'unknown',
      country: country || 'unknown',
      city: info.city || 'unknown',
      region: info.region || 'unknown',
      org: info.org || 'unknown'
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { checkPublicIp };
