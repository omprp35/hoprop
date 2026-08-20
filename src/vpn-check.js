function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readJsonPage(context, url) {
  const page = await context.newPage();
  try {
    const sep = url.includes('?') ? '&' : '?';
    await page.goto(`${url}${sep}_cb=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    const text = await page.locator('body').innerText();
    return JSON.parse(text);
  } finally {
    await page.close().catch(() => {});
  }
}

async function checkPublicIp(context, expectedCountry = 'IN') {
  const expected = expectedCountry.toUpperCase();
  const checks = [];

  const providers = [
    {
      name: 'ipinfo',
      url: 'https://ipinfo.io/json',
      parse: d => ({
        ip: d.ip,
        country: d.country,
        city: d.city,
        region: d.region,
        org: d.org
      })
    },
    {
      name: 'ipapi',
      url: 'https://ipapi.co/json/',
      parse: d => ({
        ip: d.ip,
        country: d.country_code,
        city: d.city,
        region: d.region,
        org: d.org
      })
    },
    {
      name: 'ipwho',
      url: 'https://ipwho.is/',
      parse: d => ({
        ip: d.ip,
        country: d.country_code,
        city: d.city,
        region: d.region,
        org: d.connection?.org || d.connection?.isp
      })
    }
  ];

  for (const provider of providers) {
    try {
      const raw = await readJsonPage(context, provider.url);
      const info = provider.parse(raw) || {};
      const country = String(info.country || '').toUpperCase();
      if (!country) throw new Error('country missing');
      checks.push({
        provider: provider.name,
        ok: country === expected,
        ip: info.ip || 'unknown',
        country,
        city: info.city || 'unknown',
        region: info.region || 'unknown',
        org: info.org || 'unknown'
      });
    } catch (error) {
      checks.push({ provider: provider.name, error: error.message });
    }
    await sleep(250);
  }

  const good = checks.filter(x => x.country);
  if (!good.length) {
    throw new Error(`Could not verify VPN IP with any provider: ${checks.map(x => `${x.provider}:${x.error || '?'}`).join(', ')}`);
  }

  const countryVotes = new Map();
  for (const item of good) {
    countryVotes.set(item.country, (countryVotes.get(item.country) || 0) + 1);
  }
  const ranked = [...countryVotes.entries()].sort((a, b) => b[1] - a[1]);
  const [country, votes] = ranked[0];
  const expectedVotes = countryVotes.get(expected) || 0;

  // Majority when 2+ providers succeeded. If only one succeeded, use it.
  const ok = good.length === 1
    ? good[0].country === expected
    : expectedVotes >= Math.ceil(good.length / 2);

  const representative = good.find(x => x.country === (ok ? expected : country)) || good[0];

  return {
    ok,
    ip: representative.ip,
    country: ok ? expected : country,
    city: representative.city,
    region: representative.region,
    org: representative.org,
    votes,
    expectedVotes,
    checks
  };
}

module.exports = { checkPublicIp };
