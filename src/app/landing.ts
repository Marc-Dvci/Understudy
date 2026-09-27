/**
 * The page a visitor sees before entering the headset session.
 */
import { VisibilityState, World } from '@iwsdk/core';

export function setupLanding(world: World, onGesture: () => void, onDemo: () => void): void {
  const root = document.getElementById('landing');
  const start = document.getElementById('start') as HTMLButtonElement | null;
  const status = document.getElementById('status');
  if (!root || !start || !status) return;

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  // on a computer the page carries Meta's WebXR emulator; there it plays the
  // demo with a simulated user instead of waiting for hands that are not there
  const emulated = !!(window as unknown as { __IWSDK_EMULATION_PROFILE?: { active?: boolean } }).__IWSDK_EMULATION_PROFILE?.active;
  // ?seed=21 starts from three weeks of simulated sessions, so a single visit
  // can show the hand-over and the progress charts of a later day
  const sample = Number(new URLSearchParams(location.search).get('seed') ?? 0) > 0;
  const later = sample
    ? ' Three weeks of <strong>sample history</strong> are loaded, marked as simulated. <a href="?fresh">Start from day one instead</a>.'
    : ' To see a later day, with the hand-over and progress charts, <a href="?fresh&amp;seed=21">start with three weeks of sample history</a>.';
  const check = async () => {
    let ar = false;
    try {
      ar = !!xr && (await xr.isSessionSupported('immersive-ar'));
    } catch {
      ar = false;
    }
    if (ar && emulated) {
      start.disabled = false;
      start.textContent = 'Watch the demo';
      status.innerHTML =
        (sample
          ? 'This computer runs the Meta WebXR emulator. A simulated user with a weak left hand goes through a session three weeks in, over sample history marked as simulated. <a href="?fresh">Watch the first session instead</a>.'
          : 'This computer runs the Meta WebXR emulator. A simulated user with a weak left hand goes through the first session, or <a href="?fresh&amp;seed=21">a session three weeks in</a>.') +
        ' To use Understudy yourself, open this page in the <strong>Meta Quest Browser</strong>.';
    } else if (ar) {
      start.disabled = false;
      status.innerHTML = `Sit at a table with both hands free. No controllers needed.${later}`;
    } else {
      start.disabled = true;
      status.innerHTML =
        'Open this page in the <strong>Meta Quest Browser</strong> on Quest 3 or 3S to start. On a computer, <a href="?demo">watch the demo run in your browser</a>.';
    }
  };
  void check();

  start.addEventListener('click', () => {
    onGesture();
    // the click that starts the demo also unlocks audio, so the voice plays
    if (emulated) onDemo();
    world.launchXR();
  });
  world.visibilityState.subscribe((v) => {
    root.classList.toggle('hidden', v !== VisibilityState.NonImmersive);
  });
}
