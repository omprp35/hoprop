const fs = require('fs');
const path = require('path');

function readManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function extensionInfo(dir, label) {
  const manifest = readManifest(dir);
  if (!manifest) {
    return { label, dir, present: false, name: null, version: null, popup: null };
  }

  return {
    label,
    dir,
    present: true,
    name: manifest.name || label,
    version: manifest.version || '?',
    popup: manifest.action?.default_popup || manifest.browser_action?.default_popup || null,
    serviceWorker: manifest.background?.service_worker || null
  };
}

function existingExtensionDirs(config) {
  return [
    extensionInfo(config.customExtensionDir, 'custom'),
    extensionInfo(config.surfsharkExtensionDir, 'surfshark')
  ].filter(x => x.present);
}

module.exports = { extensionInfo, existingExtensionDirs };
