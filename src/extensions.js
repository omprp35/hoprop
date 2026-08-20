const fs = require('fs');
const path = require('path');

function inspectExtension(dir, label) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    label,
    dir,
    name: manifest.name || label,
    version: manifest.version || '?',
    manifest,
    popup:
      manifest.action?.default_popup ||
      manifest.browser_action?.default_popup ||
      null
  };
}

function getInstalledExtensions(config) {
  return [
    inspectExtension(config.customExtensionDir, 'custom'),
    inspectExtension(config.surfsharkExtensionDir, 'surfshark')
  ].filter(Boolean);
}

module.exports = { getInstalledExtensions, inspectExtension };
