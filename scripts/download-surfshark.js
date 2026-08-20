const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const EXTENSION_ID = process.env.SURFSHARK_EXTENSION_ID || 'ailoabdmgclmfmhdagmlohpjlbpffblp';
const OUTPUT_DIR = process.env.SURFSHARK_EXTENSION_DIR || path.join(process.cwd(), 'extensions', 'surfshark');
const PROD_VERSION = process.env.CHROME_PRODUCT_VERSION || '131.0.0.0';

function crxToZipBuffer(buffer) {
  if (buffer.length < 16 || buffer.subarray(0, 4).toString('ascii') !== 'Cr24') {
    // Some download endpoints may return a plain ZIP package.
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return buffer;
    throw new Error('Downloaded file is not a CRX/ZIP package');
  }

  const version = buffer.readUInt32LE(4);
  let zipOffset;

  if (version === 2) {
    const publicKeyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    zipOffset = 16 + publicKeyLength + signatureLength;
  } else if (version === 3) {
    const headerLength = buffer.readUInt32LE(8);
    zipOffset = 12 + headerLength;
  } else {
    throw new Error(`Unsupported CRX version: ${version}`);
  }

  if (zipOffset >= buffer.length || buffer[zipOffset] !== 0x50 || buffer[zipOffset + 1] !== 0x4b) {
    throw new Error('Could not locate ZIP payload inside CRX');
  }

  return buffer.subarray(zipOffset);
}

async function download() {
  const x = encodeURIComponent(`id=${EXTENSION_ID}&installsource=ondemand&uc`);
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${encodeURIComponent(PROD_VERSION)}&acceptformat=crx2,crx3&x=${x}`;

  console.log(`Downloading Surfshark Chrome extension (${EXTENSION_ID})...`);

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${PROD_VERSION} Safari/537.36`
    }
  });

  if (!response.ok) {
    throw new Error(`Chrome Web Store download failed: HTTP ${response.status}`);
  }

  const crx = Buffer.from(await response.arrayBuffer());
  const zipBuffer = crxToZipBuffer(crx);

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(OUTPUT_DIR, true);

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Surfshark package extracted, but manifest.json was not found');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Surfshark extension ready: ${manifest.name || 'Surfshark'} v${manifest.version || '?'}`);
  console.log(`Installed at: ${OUTPUT_DIR}`);
}

download().catch((error) => {
  console.error(`Surfshark extension download failed: ${error.message}`);
  process.exit(1);
});
