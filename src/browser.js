const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');
const { getInstalledExtensions } = require('./extensions');

class BrowserSession {
  constructor() {
    this.context = null;
    this.startedAt = null;
  }

  get active() {
    return Boolean(this.context);
  }

  async start() {
    if (this.active) return this.info();

    fs.mkdirSync(config.profileDir, { recursive: true });

    const extensions = getInstalledExtensions(config);
    if (!extensions.length) {
      throw new Error('No Chrome extensions found. Expected Surfshark and/or extensions/custom/manifest.json.');
    }

    const extensionPaths = extensions.map(x => x.dir).join(',');
    console.log('Loading extensions:', extensions.map(x => `${x.name} ${x.version}`).join(' | '));
    console.log('Browser profile:', config.profileDir);

    const context = await chromium.launchPersistentContext(config.profileDir, {
      headless: false,
      viewport: null,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized',
        '--window-size=1365,900',
        `--disable-extensions-except=${extensionPaths}`,
        `--load-extension=${extensionPaths}`
      ]
    });

    this.context = context;
    this.startedAt = Date.now();

    context.on('close', () => {
      if (this.context === context) {
        this.context = null;
        this.startedAt = null;
      }
    });

    const pages = context.pages();
    if (!pages.length) await context.newPage();

    return this.info();
  }

  async ensure() {
    if (!this.active) await this.start();
    return this.context;
  }

  async close() {
    if (!this.context) return;
    const context = this.context;
    this.context = null;
    this.startedAt = null;
    await context.close().catch(() => {});
  }

  async restart() {
    await this.close();
    return this.start();
  }

  async resolveExtensionId(extension) {
    if (!extension) return null;

    // Chromium normally records unpacked extensions in Preferences/Secure Preferences.
    for (const filename of ['Preferences', 'Secure Preferences']) {
      const prefsPath = path.join(config.profileDir, 'Default', filename);
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        const settings = prefs?.extensions?.settings || {};
        for (const [id, setting] of Object.entries(settings)) {
          const storedPath = setting?.path ? path.resolve(setting.path) : '';
          const wantedPath = path.resolve(extension.dir);
          const storedName = setting?.manifest?.name;
          if (storedPath === wantedPath || (storedName && storedName === extension.manifest?.name)) {
            return id;
          }
        }
      } catch {}
    }

    // Fallback to currently loaded extension workers/background pages.
    const urls = [
      ...this.context.serviceWorkers().map(w => w.url()),
      ...this.context.backgroundPages().map(p => p.url())
    ];
    const ids = [...new Set(urls.map(url => url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1]).filter(Boolean))];

    // Surfshark's official extension ID is known; if there are two loaded extensions,
    // the non-Surfshark one is the custom extension.
    if (extension.label === 'custom') {
      const nonSurfshark = ids.find(id => id !== 'ailoabdmgclmfmhdagmlohpjlbpffblp');
      if (nonSurfshark) return nonSurfshark;
    }
    if (extension.label === 'surfshark' && ids.includes('ailoabdmgclmfmhdagmlohpjlbpffblp')) {
      return 'ailoabdmgclmfmhdagmlohpjlbpffblp';
    }

    return ids.length === 1 ? ids[0] : null;
  }

  info() {
    return {
      active: this.active,
      startedAt: this.startedAt
    };
  }
}

module.exports = { BrowserSession };
