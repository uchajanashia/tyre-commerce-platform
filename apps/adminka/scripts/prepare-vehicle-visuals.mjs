import { copyFile, mkdir, readdir } from 'node:fs/promises';

// Reuse our storefront assets at build time; Admin does not depend on a live site.
const target = new URL('../public/vehicle-visuals/', import.meta.url);
const passenger = new URL('../../website/public/new_image/', import.meta.url);
const scenes = new URL('../../website/src/assets/vehicle-scenes/', import.meta.url);
await mkdir(target, { recursive: true });
let copied = 0;
for (const file of await readdir(passenger, { withFileTypes: true })) {
  if (file.isFile() && file.name.endsWith('.webp')) {
    await copyFile(new URL(file.name, passenger), new URL(file.name, target));
    copied++;
  }
}
for (const directory of await readdir(scenes, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  const folder = new URL(`${directory.name}/`, scenes);
  for (const file of await readdir(folder, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('-body.webp')) {
      await copyFile(new URL(file.name, folder), new URL(file.name.replace('-body.webp', '.webp'), target));
      copied++;
    }
  }
}
console.log(`Prepared ${copied} internally hosted vehicle visuals.`);
