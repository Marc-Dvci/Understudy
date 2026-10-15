/**
 * The page a visitor sees before entering the headset session.
 */
import { VisibilityState, World } from '@iwsdk/core';
import { isShowcaseLanding } from './emulation/showcase-options.js';

export function setupLanding(world: World, onGesture: () => void, onDemo: () => void): void {
  const root = document.getElementById('landing');
  const start = document.getElementById('start') as HTMLButtonElement | null;
  const status = document.getElementById('status');
  const demoPaths = document.getElementById('demo-paths');
  if (!root || !start || !status) return;

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  // on a computer the page carries Meta's WebXR emulator; there it plays the
  // demo with a simulated user instead of waiting for hands that are not there
  const emulated = !!(window as unknown as { __IWSDK_EMULATION_PROFILE?: { active?: boolean } }).__IWSDK_EMULATION_PROFILE?.active;
  // ?seed=21 starts from three weeks of simulated sessions, so a single visit
  // can show the hand-over and the progress charts of a later day
  const query = new URLSearchParams(location.search);
  const sample = Number(query.get('seed') ?? 0) > 0;
  const quick = isShowcaseLanding(query, emulated);
  const later = sample
    ? ' <strong>Sample history</strong> is loaded in a separate temporary session. Your saved data stays intact. <a href="./">Return to your own sessions</a>.'
    : ' To see the hand-over and progress charts, <a href="?fresh&amp;seed=21">try three weeks of sample history</a>. This keeps your saved sessions intact.';
  const check = async () => {
    let ar = false;
    try {
      ar = !!xr && (await xr.isSessionSupported('immersive-ar'));
    } catch {
      ar = false;
    }
    if (ar && emulated) {
      start.disabled = false;
      start.textContent = quick ? 'Explore handover' : 'Watch the demo';
      if (demoPaths) {
        demoPaths.hidden = false;
      }
      status.innerHTML =
        (quick
          ? 'Explore the actual app in Meta’s WebXR emulator. Jump between handover, Progress and Hand Print, and compare the three render modes at your own pace.'
          : sample
            ? 'Watch a complete later visit with three weeks of sample history in Meta’s WebXR emulator.'
            : query.get('program') === 'deskbreak'
              ? 'Watch a two-minute desk break for two working hands in Meta’s WebXR emulator.'
              : 'Watch first-time setup and a complete session in Meta’s WebXR emulator.') +
        ' Hands and history are simulated; samples stay separate from personal records. For your own session, use <strong>Meta Quest Browser</strong>.';
    } else if (ar) {
      start.disabled = false;
      status.innerHTML = `Sit at a table with your working hand free. No controllers needed.${query.has('fresh') && !sample ? ' This is a temporary practice session. <a href="./">Return to your saved sessions</a>.' : later}`;
    } else {
      start.disabled = true;
      status.innerHTML =
        'Open this page in the <strong>Meta Quest Browser</strong> on Quest 3 or 3S to start. On a computer, <a href="?demo">watch the demo run in your browser</a>.';
    }
  };
  void check();

  start.addEventListener('click', () => {
    onGesture();
    if (quick && !query.has('showcase')) {
      const next = new URL(location.href);
      next.searchParams.set('fresh', '');
      next.searchParams.set('showcase', 'handover');
      window.history.replaceState(null, '', next);
    }
    if (quick) {
      // Reserve a desktop control strip. The emulator's visible compositor
      // scales the full-size XR image uniformly into the remaining space.
      document.body.classList.add('showcase-active');
    }
    // the click that starts the demo also unlocks audio, so the voice plays
    if (emulated) onDemo();
    world.launchXR();
  });
  world.visibilityState.subscribe((v) => {
    root.classList.toggle('hidden', v !== VisibilityState.NonImmersive);
  });
}
