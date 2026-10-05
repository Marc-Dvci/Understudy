/**
 * Understudy: mixed-reality mirror therapy on your own table.
 */
import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sound } from './app/audio.js';
import { flow } from './app/flow/engine.js';
import { runApp } from './app/flow/main.js';
import { services } from './app/flow/services.js';
import { FlowSystem } from './app/flow-system.js';
import { HandInputSystem } from './app/hands.js';
import { setupLanding } from './app/landing.js';
import { MirrorSystem } from './app/mirror-system.js';
import { stage, StageSystem } from './app/stage.js';
import { state } from './app/state.js';
import { store } from './app/store.js';
import { StationSystem } from './app/station.js';
import { QualitySystem } from './app/quality.js';
import { loadFonts } from './app/ui/text.js';

const base = import.meta.env.BASE_URL;
services.base = base;
sound.base = base;
const params = new URLSearchParams(location.search);
// a one-shot fresh start, settable from dev tools where the query string is not kept
let freshFlag = false;
try {
  freshFlag = sessionStorage.getItem('understudy.fresh') === '1';
  sessionStorage.removeItem('understudy.fresh');
} catch {
  freshFlag = false;
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(async (world) => {
  await loadFonts(base);
  world.registerSystem(HandInputSystem, { priority: -40 });
  world.registerSystem(StationSystem, { priority: -30 });
  world.registerSystem(FlowSystem, { priority: -20 });
  world.registerSystem(MirrorSystem, { priority: -10 });
  world.registerSystem(StageSystem, { priority: 0 });
  world.registerSystem(QualitySystem, { priority: 10 });
  services.quality = world.getSystem(QualitySystem) ?? null;
  services.station = world.getSystem(StationSystem) ?? null;
  services.mirror = world.getSystem(MirrorSystem) ?? null;
  const flowSystem = world.getSystem(FlowSystem)!;
  // the autopilot runs in the emulator unless ?manual is set
  flowSystem.wantAutopilot = params.has('demo') || (import.meta.env.DEV && !params.has('manual'));
  flowSystem.demoRoom = !params.has('sem') && !params.has('noroom');
  if (params.get('input') === 'gaze') stage.press.gazeEnabled = true;
  if (params.has('nolabel') && services.station) services.station.ignoreLabels = true;

  world.createTransformEntity(stage.root);
  await stage.loadHands(base);

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    stage.trackedStyle = flowSystem.autopilot || state.emulated ? 'skin' : 'occluder';
    void runApp({ fresh: freshFlag || params.has('fresh') || params.has('demo') || demoMode }).catch((e) => console.error('[understudy] flow failed', e));
  };
  world.visibilityState.subscribe((v) => {
    if (v !== VisibilityState.NonImmersive) {
      sound.resume();
      // give the emulator a frame to install the autopilot before choosing hand styles
      setTimeout(start, 300);
    }
    flow.suspended = v === VisibilityState.VisibleBlurred || v === VisibilityState.NonImmersive;
    sound.setPaused(flow.paused);
  });
  let demoMode = false;
  setupLanding(
    world,
    () => sound.resume(),
    () => {
      // a computer with the emulator: the demo plays with the simulated user
      demoMode = true;
      flowSystem.wantAutopilot = true;
    },
  );
  // offline cache for daily use; production builds only
  if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => undefined);
  }
  // launched from the Quest library as an installed app: the icon tap is the
  // user activation, so the session starts straight away
  if ('getDigitalGoodsService' in window) {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    xr?.isSessionSupported('immersive-ar')
      .then((ok) => {
        if (ok) {
          sound.resume();
          world.launchXR();
        }
      })
      .catch(() => undefined);
  }
  (window as unknown as Record<string, unknown>).__understudy = { state, flow, stage, world, store, flowSystem, quality: services.quality };
}).catch((error: unknown) => {
  console.error('[understudy] startup failed', error);
  const status = document.getElementById('status');
  const start = document.getElementById('start') as HTMLButtonElement | null;
  if (status) status.textContent = 'Understudy could not finish loading. Reload this page to try again. If you are offline, reconnect once to download the app.';
  if (start) start.disabled = true;
});
