import { readFile, writeFile } from 'node:fs/promises';

const buildId = process.env.GITHUB_SHA || new Date().toISOString();
const source = await readFile('src/pwa/service-worker.js', 'utf8');
const worker = source.replaceAll('__WWM_BUILD_ID__', buildId);

if (worker.includes('__WWM_BUILD_ID__')) throw new Error('Service worker build identifier was not injected.');
await writeFile('dist/service-worker.js', worker);
