import { readFile, writeFile } from 'node:fs/promises';

const buildId = process.env.GITHUB_SHA || new Date().toISOString();
const source = await readFile('src/pwa/service-worker.js', 'utf8');
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const assets = new Set();
const visited = new Set();
const collectEntryAssets = (key) => {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  assets.add(`/${chunk.file}`);
  for (const file of chunk.css || []) assets.add(`/${file}`);
  for (const dependency of chunk.imports || []) collectEntryAssets(dependency);
};
for (const [key, chunk] of Object.entries(manifest)) {
  if (chunk.isEntry) collectEntryAssets(key);
}
if (!assets.size) throw new Error('No entry assets found for the offline app shell.');
const worker = source.replaceAll('__WWM_BUILD_ID__', buildId)
  .replace('/* __WWM_PRECACHE_ASSETS__ */', [...assets].sort().map((file) => JSON.stringify(file)).join(', '));

if (worker.includes('__WWM_BUILD_ID__')) throw new Error('Service worker build identifier was not injected.');
await writeFile('dist/service-worker.js', worker);
