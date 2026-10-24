// Frame work on a slowed CPU: the time each frame spends in the app's systems
// and in Three.js render submission, through a complete later session in IWER.
// The page's CPU is throttled (CPU_RATE, default 4x) to approach a mobile
// processor. It also records every shader program compiled after the session
// started, since a compile on a headset stalls the frame that first draws it.
//   APP_URL=https://127.0.0.1:4180/ LABEL=after node tools/check-frame-work.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser-options.mjs';

const APP_URL = process.env.APP_URL ?? 'https://localhost:8081/';
const LABEL = process.env.LABEL ?? 'after';
const RATE = Number(process.env.CPU_RATE ?? 4);
const QUERY = process.env.QUERY ?? '?fresh&seed=21&demo&noroom';
const OUT = process.env.OUT ?? `verification/frame-work.json`;

const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  await page.goto(new URL(QUERY, APP_URL).href);
  await page.waitForFunction(() => !!window.__understudy && !document.getElementById('start')?.disabled, null, { timeout: 90000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  await page.evaluate(() => {
    const u = window.__understudy;
    const r = u.world.renderer;
    const rec = (window.__frameWork = { frames: [], late: [], heap: [], sessionAt: null, programsAtStart: 0, warm: null });
    let work = 0;
    const update = u.world.update.bind(u.world);
    u.world.update = (...a) => {
      const t = performance.now();
      update(...a);
      work = performance.now() - t;
    };
    const render = r.render.bind(r);
    let programs = 0;
    r.render = (...a) => {
      const t = performance.now();
      render(...a);
      const total = work + (performance.now() - t);
      if (!u.state.immersive) return;
      const now = performance.now();
      if (rec.sessionAt === null) {
        rec.sessionAt = now;
        programs = r.info.programs?.length ?? 0;
        rec.programsAtStart = programs;
      }
      rec.frames.push([Math.round((now - rec.sessionAt) / 10) / 100, Math.round(total * 100) / 100, u.flow.step]);
      const n = r.info.programs?.length ?? 0;
      if (n > programs) {
        rec.late.push({ t: Math.round(now - rec.sessionAt), step: u.flow.step, added: n - programs, frameMs: Math.round(total * 10) / 10, duringWarmUp: !!u.quality && 'requestWarmUp' in u.quality && !rec.warm });
        programs = n;
      }
      if (!rec.warm && u.quality?.warm) rec.warm = { ...u.quality.warm, doneAt: Math.round(now - rec.sessionAt) };
    };
    setInterval(() => {
      const m = performance.memory;
      if (m && rec.sessionAt !== null) rec.heap.push([Math.round(performance.now() - rec.sessionAt), m.usedJSHeapSize]);
    }, 1000);
  });
  await page.click('#start');
  const reached = await page
    .waitForFunction(() => {
      const u = window.__understudy;
      return u.flow.log.some((l) => l.step === 'done') && u.flow.step === 'home';
    }, null, { timeout: 600000, polling: 1000 })
    .then(() => true)
    .catch(() => false);
  const raw = await page.evaluate(() => {
    const r = window.__frameWork;
    return { frames: r.frames, late: r.late, heap: r.heap, warm: r.warm, programsAtStart: r.programsAtStart, programsAtEnd: window.__understudy.world.renderer.info.programs?.length ?? 0 };
  });
  const q = (v, p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
  // the first two seconds hold session start: shader warm-up and first uploads
  const steady = raw.frames.filter((f) => f[0] >= 2).map((f) => f[1]).sort((a, b) => a - b);
  const startup = raw.frames.filter((f) => f[0] < 2).map((f) => f[1]);
  const byStep = {};
  for (const [, ms, step] of raw.frames) (byStep[step] ??= []).push(ms);
  const steps = Object.fromEntries(
    Object.entries(byStep).map(([s, v]) => {
      v.sort((a, b) => a - b);
      return [s, { frames: v.length, p50: q(v, 0.5), p95: q(v, 0.95), max: v[v.length - 1] }];
    }),
  );
  const slowest = raw.frames.filter((f) => f[0] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, ms, step]) => ({ t, ms, step }));
  // heap growth while the routine runs: garbage made per second, a proxy for collector pauses
  let rise = 0;
  for (let i = 1; i < raw.heap.length; i++) rise += Math.max(0, raw.heap[i][1] - raw.heap[i - 1][1]);
  const spanS = raw.heap.length > 1 ? (raw.heap[raw.heap.length - 1][0] - raw.heap[0][0]) / 1000 : 0;
  const result = {
    label: LABEL,
    recorded: new Date().toISOString(),
    scope: `Windows Chromium with Meta IWER, page CPU throttled ${RATE}x. Per-frame CPU time in world.update and renderer.render; GPU execution is not included.`,
    url: new URL(QUERY, APP_URL).href,
    reached,
    frames: steady.length,
    steadyMs: { p50: q(steady, 0.5), p95: q(steady, 0.95), p99: q(steady, 0.99), max: steady[steady.length - 1] ?? 0 },
    startupMaxMs: startup.length ? Math.max(...startup) : 0,
    over8ms: steady.filter((x) => x > 8).length,
    // compiles while the warm-up runs are intended; any later one stalls a frame the user sees
    programs: { atSessionStart: raw.programsAtStart, atEnd: raw.programsAtEnd, warmUp: raw.warm, compiledDuringRoutine: raw.late.filter((l) => !l.duringWarmUp && l.step !== 'boot') },
    heapRiseMBPerS: spanS ? Math.round((rise / spanS / 1048576) * 100) / 100 : null,
    slowest,
    steps,
    errors: errors.slice(0, 5),
  };
  mkdirSync('verification', { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label: LABEL, reached, frames: result.frames, steadyMs: result.steadyMs, startupMaxMs: result.startupMaxMs, over8ms: result.over8ms, routineCompiles: result.programs.compiledDuringRoutine.length, programs: result.programs.atEnd, heapRiseMBPerS: result.heapRiseMBPerS, errors: errors.length }));
} finally {
  await browser.close();
}
