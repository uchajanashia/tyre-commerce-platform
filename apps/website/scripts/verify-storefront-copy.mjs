import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const appDir = resolve(scriptDir, '../src/app');
const indexPath = resolve(scriptDir, '../src/index.html');
const forbidden = [
  /გარანტირებული თავსებადობა/iu,
  /ზუსტად\s+(?:მოერგება|ერგება)/iu,
  /ყველაფერი გადამოწმებულია/iu,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dev') continue;
      files.push(...(await sourceFiles(path)));
    } else if (['.ts', '.html'].includes(extname(entry.name)) && !entry.name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

const failures = [];
for (const path of [...(await sourceFiles(appDir)), indexPath]) {
  const source = await readFile(path, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) failures.push(`${relative(appDir, path)}: ${pattern.source}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Unverifiable fitment claims found:\n${failures.join('\n')}`);
}
console.log('Storefront copy check passed: no absolute fitment claims found.');
