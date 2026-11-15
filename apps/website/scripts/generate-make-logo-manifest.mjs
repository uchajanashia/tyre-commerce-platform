import { readFile, readdir, writeFile } from 'node:fs/promises';

const makeAssetsDirectory = new URL('../src/assets/makes/', import.meta.url);
const manifestPath = new URL('../src/assets/makes/manifest.json', import.meta.url);

const entries = await readdir(makeAssetsDirectory, { withFileTypes: true });
const logoKeys = entries
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.webp'))
  .map((entry) => entry.name.slice(0, -'.webp'.length))
  .sort((left, right) => left.localeCompare(right));
const manifest = `${JSON.stringify(logoKeys, null, 2)}\n`;

let current = '';
try {
  current = await readFile(manifestPath, 'utf8');
} catch {
  // First generation creates the manifest.
}

if (current !== manifest) {
  await writeFile(manifestPath, manifest, 'utf8');
}

console.log(`Generated make-logo manifest with ${logoKeys.length} assets.`);
