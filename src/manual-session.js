const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./automation');
const { openSurfsharkPopup } = require('./surfshark');

const DEFAULT_TIMEOUT_MINUTES = Number(process.env.MANUAL_SESSION_MINUTES || 15);

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function normalizePublicUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) throw new Error('URL is empty.');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// URLs are allowed.');
  if (isPrivateHost(url.hostname)) throw new Error('Local/private network URLs are blocked in manual session mode.');
  return url.toString();
}

class ManualSession {
  constructor() {
    this.context = null;
    this.page = null;
    this.chatId = null;
    this.startedAt = null;
    this.lastActivityAt = null;
    this.timeout = null;
  }

  get active() {
    return Boolean(this.context);
  }

  belongsTo(chatId) {
    return this.active && String(this.chatId) === String(chatId);
  }

  touch() {
    this.lastActivityAt = Date.now();
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.close().catch(() => {});
    }, Math.max(1, DEFAULT_TIMEOUT_MINUTES) * 60 * 1000);
    if (typeof this.timeout.unref === 'function') this.timeout.unref();
  }

  async start(chatId) {
    if (this.active) {
      if (!this.belongsTo(chatId)) throw new Error('A manual browser session is already active for another chat.');
      this.touch();
      return this.info();
    }

    const { context } = await launchBrowser();
    this.context = context;
    this.chatId = String(chatId);
    this.startedAt = Date.now();
    this.touch();

    // Start on the Surfshark extension so the user can inspect it immediately.
    try {
      const opened = await openSurfsharkPopup(context);
      this.page = opened.page;
    } catch {
      const pages = context.pages();
      this.page = pages[0] || await context.newPage();
    }

    return this.info();
  }

  assert(chatId) {
    if (!this.active) throw new Error('No manual session is active. Tap 🖥 Manual Session first.');
    if (!this.belongsTo(chatId)) throw new Error('This manual session belongs to another Telegram chat.');
    this.touch();
  }

  async ensurePage(chatId) {
    this.assert(chatId);
    if (!this.page || this.page.isClosed()) {
      const pages = this.context.pages().filter(p => !p.isClosed());
      this.page = pages[0] || await this.context.newPage();
    }
    return this.page;
  }

  async info() {
    if (!this.active) return { active: false };
    const page = this.page && !this.page.isClosed() ? this.page : null;
    return {
      active: true,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      url: page ? page.url() : '',
      title: page ? await page.title().catch(() => '') : '',
      timeoutMinutes: DEFAULT_TIMEOUT_MINUTES
    };
  }

  async openSurfshark(chatId) {
    this.assert(chatId);
    const opened = await openSurfsharkPopup(this.context);
    this.page = opened.page;
    await this.page.bringToFront().catch(() => {});
    return this.info();
  }

  async openIpCheck(chatId) {
    this.assert(chatId);
    const page = await this.ensurePage(chatId);
    await page.goto('https://ipinfo.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    return this.info();
  }

  async goto(chatId, rawUrl) {
    const page = await this.ensurePage(chatId);
    const url = normalizePublicUrl(rawUrl);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(700);
    return this.info();
  }

  async screenshot(chatId, { grid = false } = {}) {
    const page = await this.ensurePage(chatId);
    await page.bringToFront().catch(() => {});
    let overlayId = null;

    if (grid) {
      overlayId = `manual-grid-${Date.now()}`;
      await page.evaluate((id) => {
        const old = document.getElementById(id);
        if (old) old.remove();
        const root = document.createElement('div');
        root.id = id;
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:12px monospace;color:#ff2d2d;text-shadow:0 0 2px white;background-image:linear-gradient(to right,rgba(255,0,0,.35) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,0,0,.35) 1px,transparent 1px);background-size:100px 100px;';
        for (let y = 0; y < innerHeight; y += 100) {
          for (let x = 0; x < innerWidth; x += 100) {
            const label = document.createElement('span');
            label.textContent = `${x},${y}`;
            label.style.cssText = `position:absolute;left:${x + 3}px;top:${y + 3}px;background:rgba(255,255,255,.75);padding:1px 2px;border-radius:2px;`;
            root.appendChild(label);
          }
        }
        document.documentElement.appendChild(root);
      }, overlayId).catch(() => {});
    }

    const filePath = path.join('/tmp', `manual-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: false });

    if (overlayId) {
      await page.evaluate((id) => document.getElementById(id)?.remove(), overlayId).catch(() => {});
    }

    return { filePath, ...(await this.info()) };
  }

  async click(chatId, x, y) {
    const page = await this.ensurePage(chatId);
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('Use /click X Y, for example /click 640 450');
    if (px < 0 || py < 0 || px > 1280 || py > 900) throw new Error('Coordinates must be inside the 1280×900 browser viewport.');
    await page.mouse.click(px, py);
    await page.waitForTimeout(600);
    return this.info();
  }

  async type(chatId, text) {
    const page = await this.ensurePage(chatId);
    const value = String(text || '');
    if (!value) throw new Error('Use /type followed by text. Example: /type india');
    await page.keyboard.type(value, { delay: 25 });
    await page.waitForTimeout(300);
    return this.info();
  }

  async press(chatId, key) {
    const page = await this.ensurePage(chatId);
    const allowed = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);
    if (!allowed.has(key)) throw new Error(`Unsupported key. Try one of: ${[...allowed].join(', ')}`);
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    return this.info();
  }

  async scroll(chatId, deltaY) {
    const page = await this.ensurePage(chatId);
    await page.mouse.wheel(0, Number(deltaY));
    await page.waitForTimeout(400);
    return this.info();
  }

  async refresh(chatId) {
    const page = await this.ensurePage(chatId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(700);
    return this.info();
  }

  async close(chatId = null) {
    if (!this.active) return;
    if (chatId !== null && !this.belongsTo(chatId)) throw new Error('This manual session belongs to another Telegram chat.');
    if (this.timeout) clearTimeout(this.timeout);
    const context = this.context;
    this.context = null;
    this.page = null;
    this.chatId = null;
    this.startedAt = null;
    this.lastActivityAt = null;
    this.timeout = null;
    await context.close().catch(() => {});
  }
}

module.exports = { ManualSession };
