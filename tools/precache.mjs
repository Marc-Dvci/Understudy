// Stamp dist/sw.js with the content-derived cache name and complete app asset
// list. A first online visit then prepares the whole daily experience offline.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const dist = resolve('dist');
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && entry.name === 'AGENTS.md') unlinkSync(path);
    else if (entry.isFile() && entry.name !== 'sw.js' && !entry.name.endsWith('.map')) files.push(path);
  }
}
walk(dist);
files.sort((a, b) => a.localeCompare(b));

const hash = createHash('sha256');
const urls = ['./'];
for (const path of files) {
  const name = relative(dist, path).split(sep).join('/');
  urls.push(`./${name}`);
  hash.update(name);
  hash.update(readFileSync(path));
}
const version = hash.digest('hex').slice(0, 12);
const script = resolve(dist, 'sw.js');
let sw = readFileSync(script, 'utf8');
if (!sw.includes("const CACHE = 'understudy-v1';") || !sw.includes("const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];")) {
  throw new Error('Service worker build markers changed');
}
sw = sw.replace("const CACHE = 'understudy-v1';", `const CACHE = 'understudy-${version}';`);
sw = sw.replace("const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];", `const PRECACHE = ${JSON.stringify(urls)};`);
writeFileSync(script, sw);
console.log(`Offline cache: ${urls.length} URLs, version ${version}`);
