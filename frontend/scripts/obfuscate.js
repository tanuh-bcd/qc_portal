const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { createHash } = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');

const BUILD_DIR = join(__dirname, '..', 'build');
const JS_DIR = join(BUILD_DIR, 'static', 'js');
const SW_PATH = join(BUILD_DIR, 'service-worker.js');

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  unicodeEscapeSequence: false,
  selfDefending: false,
  sourceMap: false,
};

const files = readdirSync(JS_DIR).filter(f => f.startsWith('main.') && f.endsWith('.js'));

if (files.length === 0) {
  console.log('No main bundle found — skipping obfuscation.');
  process.exit(0);
}

for (const file of files) {
  const filePath = join(JS_DIR, file);
  console.log(`Obfuscating ${file}...`);
  const code = readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, options);
  writeFileSync(filePath, result.getObfuscatedCode());
  console.log('Done.');
}

// Append a fingerprint to the service worker so the browser detects
// that assets changed and re-caches them on the next visit.
try {
  const mainPath = join(JS_DIR, files[0]);
  const hash = createHash('md5').update(readFileSync(mainPath)).digest('hex').slice(0, 8);
  const sw = readFileSync(SW_PATH, 'utf8');
  writeFileSync(SW_PATH, sw + `\n// build:${hash}\n`);
  console.log(`Service worker fingerprint updated (${hash}).`);
} catch (e) {
  console.log('Service worker fingerprint skipped:', e.message);
}
