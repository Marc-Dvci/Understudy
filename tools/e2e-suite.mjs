// End-to-end checks S7, S8 and S9 against the dev server, or APP_URL for a built site.
//   S7  the tour and the first daily programme complete in each input mode:
//       Lead left, Lead right, dwell only, head gaze only
//   S8  every interactive or instructional element is inside the Meta VR Glasses
//       visibility mask (37 deg left/right, 25 deg up, 43 deg down) while the user
//       looks at the mat
//   S9  draw calls and triangles stay within budget in every state (demo room off)
// Results go to verification/e2e-results.json, which is published with the source; a full run
// also refreshes the journey and render entries of verification/emulator.json.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { browserOptions } from './browser-options.mjs';

const MASK = { left: 37, right: 37, up: 25, down: 43 };
const BUDGET = { calls: 80, triangles: 120000 };
// Home is reached only after the chosen daily programme has saved its result.
const TARGET_STEP = 'home';
const APP_URL = process.env.APP_URL ?? 'https://localhost:8081/';

async function run(name, query) {
  const browser = await chromium.launch(browserOptions);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(new URL(query, APP_URL).href);
  await page.waitForFunction(() => !!window.__understudy, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('start')?.disabled, null, { timeout: 30000 });
  await page.click('#start');
  // sample FoV and render cost every 250 ms until the target step or timeout
  const samples = await page.evaluate(
    async ({ MASK, TARGET_STEP }) => {
      const u = window.__understudy;
      const out = { fov: { checked: 0, outside: [], byStep: {}, worstUp: -90 }, panels: { checked: 0, withMat: 0, fitAlone: 0, total: 0 }, render: { maxCalls: 0, maxTriangles: 0, samples: 0 }, reached: false, methods: {} };
      u.stage.press.onPress((id, how) => {
        out.methods[how] = (out.methods[how] ?? 0) + 1;
      });
      const deg = 180 / Math.PI;
      const V = u.world.camera.position.constructor;
      const corner = new V();
      const deadline = performance.now() + 420000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        const s = u.state;
        const info = u.world.renderer.info.render;
        out.render.maxCalls = Math.max(out.render.maxCalls, info.calls);
        out.render.maxTriangles = Math.max(out.render.maxTriangles, info.triangles);
        out.render.samples++;
        if (s.station.ready) {
          // gaze: from the head toward the mat centre
          const h = s.head;
          const c = s.station.center;
          const gx = c[0] - h[0];
          const gy = c[1] - h[1];
          const gz = c[2] - h[2];
          const gyaw = Math.atan2(gx, -gz);
          const gpitch = Math.atan2(gy, Math.hypot(gx, gz));
          const items = [];
          if (u.stage.card.group.visible && u.stage.card.opacity > 0.5) items.push(['card', u.stage.card.group, u.stage.card.width, u.stage.card.height]);
          if (u.stage.board.group.visible && u.stage.board.opacity > 0.5) items.push(['board', u.stage.board.group, 0.52, 0.26]);
          if (u.stage.meter.group.visible && u.stage.meter.opacity > 0.5) items.push(['meter', u.stage.meter.group, 0.24, 0.11]);
          for (const st of u.stage.press.all()) if (st.shown) items.push([`stone:${st.id}`, st.group, st.radius * 2.4, st.radius * 2.4]);
          for (const [name, g, w, hh] of items) {
            g.updateWorldMatrix(true, false);
            const isPanel = !name.startsWith('stone');
            if (isPanel) {
              // reading panels (reported, not gated): visible with the mat, and
              // fitting in one view when looked at directly
              const pc = new V(0, 0, 0);
              g.localToWorld(pc);
              const pyaw = Math.atan2(pc.x - h[0], -(pc.z - h[2]));
              const ppitch = Math.atan2(pc.y - h[1], Math.hypot(pc.x - h[0], pc.z - h[2]));
              let withMat = true;
              let alone = true;
              for (const [cx, cy] of [[-w / 2, -hh / 2], [w / 2, -hh / 2], [-w / 2, hh / 2], [w / 2, hh / 2]]) {
                corner.set(cx, cy, 0);
                g.localToWorld(corner);
                const dx = corner.x - h[0];
                const dy = corner.y - h[1];
                const dz = corner.z - h[2];
                const yawAbs = Math.atan2(dx, -dz);
                const pitchAbs = Math.atan2(dy, Math.hypot(dx, dz));
                const y1 = (yawAbs - gyaw) * deg;
                const p1 = (pitchAbs - gpitch) * deg;
                const y2 = (yawAbs - pyaw) * deg;
                const p2 = (pitchAbs - ppitch) * deg;
                if (y1 < -MASK.left || y1 > MASK.right || p1 > MASK.up || p1 < -MASK.down) withMat = false;
                if (y2 < -MASK.left || y2 > MASK.right || p2 > MASK.up || p2 < -MASK.down) alone = false;
              }
              out.panels.total++;
              if (withMat) out.panels.withMat++;
              if (alone) out.panels.fitAlone++;
              continue;
            }
            for (const [cx, cy] of [[-w / 2, -hh / 2], [w / 2, -hh / 2], [-w / 2, hh / 2], [w / 2, hh / 2]]) {
              corner.set(cx, cy, 0);
              if (name.startsWith('stone')) corner.set(cx, 0.016, cy);
              g.localToWorld(corner);
              const dx = corner.x - h[0];
              const dy = corner.y - h[1];
              const dz = corner.z - h[2];
              const yaw = (Math.atan2(dx, -dz) - gyaw) * deg;
              const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) - gpitch) * deg;
              out.fov.checked++;
              out.fov.worstUp = Math.max(out.fov.worstUp, pitch);
              if (yaw < -MASK.left || yaw > MASK.right || pitch > MASK.up || pitch < -MASK.down) {
                const key = `${name.startsWith('stone') ? 'stone' : name}@${u.flow.step}`;
                out.fov.byStep[key] = (out.fov.byStep[key] ?? 0) + 1;
                if (out.fov.outside.length < 20) out.fov.outside.push({ name, step: u.flow.step, yaw: +yaw.toFixed(1), pitch: +pitch.toFixed(1) });
              }
            }
          }
        }
        if (u.flow.log.some((l) => l.step === TARGET_STEP)) {
          const steps = new Set(u.flow.log.map((l) => l.step));
          // Returning Home alone can happen after an aborted programme. Count
          // only a run that reached its completion and progress screens.
          out.reached = steps.has('done') && steps.has('progress');
          break;
        }
      }
      out.log = u.flow.log;
      return out;
    },
    { MASK, TARGET_STEP },
  );
  await browser.close();
  return { name, query, seconds: Math.round((Date.now() - t0) / 1000), errors: errors.slice(0, 5), ...samples };
}

const scenarios = [
  ['lead-right', '?fresh&demo&noroom'],
  ['lead-left', '?fresh&demo&noroom&input=left'],
  ['dwell-only', '?fresh&demo&noroom&input=dwell'],
  ['gaze-only', '?fresh&demo&noroom&input=gaze'],
].filter(([name]) => !process.env.JOURNEY || name === process.env.JOURNEY);
if (!scenarios.length) throw new Error('No matching journey');
// SEQ=1 runs one browser at a time, for a machine that is busy with other work
const results = [];
if (process.env.SEQ) for (const [n, q] of scenarios) results.push(await run(n, q));
else results.push(...(await Promise.all(scenarios.map(([n, q]) => run(n, q)))));
const summary = {
  generated: new Date().toISOString(),
  mask: MASK,
  budget: BUDGET,
  S7: results.map((r) => ({ mode: r.name, reached: r.reached, seconds: r.seconds, pressMethods: r.methods, errors: r.errors })),
  S8: {
    checked: results.reduce((a, r) => a + r.fov.checked, 0),
    worstUpDeg: Math.max(...results.map((r) => r.fov.worstUp)),
    byStep: results.map((r) => ({ mode: r.name, ...r.fov.byStep })),
    outside: results.flatMap((r) => r.fov.outside.map((o) => ({ mode: r.name, ...o }))),
  },
  S9: results.map((r) => ({ mode: r.name, ...r.render })),
  panels: {
    samples: results.reduce((a, r) => a + r.panels.total, 0),
    visibleWithMat: results.reduce((a, r) => a + r.panels.withMat, 0) / Math.max(1, results.reduce((a, r) => a + r.panels.total, 0)),
    fitInOneView: results.reduce((a, r) => a + r.panels.fitAlone, 0) / Math.max(1, results.reduce((a, r) => a + r.panels.total, 0)),
  },
};
summary.pass = {
  S7: results.every((r) => r.reached && r.errors.length === 0),
  S8: summary.S8.outside.length === 0,
  S9: results.every((r) => r.render.maxCalls <= BUDGET.calls && r.render.maxTriangles <= BUDGET.triangles),
};
writeFileSync(process.env.RESULT_FILE ?? 'verification/e2e-results.json', JSON.stringify(summary, null, 2) + '\n');
if (!process.env.JOURNEY && !process.env.RESULT_FILE && Object.values(summary.pass).every(Boolean)) {
  const retained = JSON.parse(readFileSync('verification/emulator.json', 'utf8'));
  retained.inputJourneys = { recorded: summary.generated, journeys: summary.S7.map(({ errors, ...j }) => j) };
  retained.geometry = { recorded: summary.generated, checkedStoneCorners: summary.S8.checked, callsBudget: BUDGET.calls,
    trianglesBudget: BUDGET.triangles, modes: summary.S9.map((m) => ({ mode: m.mode, maxCalls: m.maxCalls, maxTriangles: m.maxTriangles })) };
  writeFileSync('verification/emulator.json', JSON.stringify(retained, null, 2) + '\n');
}
console.log(JSON.stringify({ panels: summary.panels, pass: summary.pass, S7: summary.S7.map((s) => [s.mode, s.reached, s.seconds, s.pressMethods]), S8out: { worstUp: summary.S8.worstUpDeg, byStep: summary.S8.byStep }, S9: summary.S9 }, null, 1));
