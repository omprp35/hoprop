const config = require('./config');
const { extensionInfo } = require('./extensions');

for (const info of [
  extensionInfo(config.customExtensionDir, 'custom'),
  extensionInfo(config.surfsharkExtensionDir, 'surfshark')
]) {
  console.log(JSON.stringify(info, null, 2));
}
