// Quest Browser entry: the production build injects Meta IWER for desktop
// browsers only. With Quest Browser's user agent, the page must keep the
// browser's own WebXR (navigator.xr an XRSystem), mark nothing as emulated and
// load without errors; a desktop user agent must still get the emulator.
//   APP_URL=https://127.0.0.1:4181/ node tools/check-quest-entry.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { browserOptions } from './browser-options.mjs';

const APP_URL = process.env.APP_URL ?? 'https://localhost:8081/';
const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.2.0.7.47 SamsungBrowser/4.0 Chrome/140.0.7339.207 VR Safari/537.36';

const browser = await chromium.launch(browserOptions);
const runs = [];
try {
  for (const [name, userAgent] of [['quest-browser', QUEST_UA], ['desktop', null]]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, ...(userAgent ? { userAgent } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(APP_URL);
    await page.waitForFunction(() => !!window.__understudy, null, { timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Loading') === false, null, { timeout: 30000 });
    const seen = await page.evaluate(() => ({
      emulator: window.__IWSDK_EMULATION_PROFILE?.device ?? null,
      nativeXR: Object.prototype.toString.call(navigator.xr) === '[object XRSystem]',
      emulated: window.__understudy.state.emulated,
    }));
    runs.push({ name, ...seen, errors });
    await context.close();
  }
} finally {
  await browser.close();
}
const quest = runs.find((r) => r.name === 'quest-browser');
const desktop = runs.find((r) => r.name === 'desktop');
const result = {
  generated: new Date().toISOString(),
  url: APP_URL,
  questUserAgent: QUEST_UA,
  runs,
  pass: quest.emulator === null && quest.nativeXR && !quest.emulated && quest.errors.length === 0 && desktop.emulator !== null && desktop.errors.length === 0,
};
writeFileSync('verification/quest-entry.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, runs }));
