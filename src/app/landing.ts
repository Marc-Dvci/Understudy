/**
 * The page a visitor sees before entering the headset session.
 */
import { VisibilityState, World } from '@iwsdk/core';

export function setupLanding(world: World, onGesture: () => void): void {
  const root = document.getElementById('landing');
  const start = document.getElementById('start') as HTMLButtonElement | null;
  const status = document.getElementById('status');
  if (!root || !start || !status) return;

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  const check = async () => {
    let ar = false;
    try {
      ar = !!xr && (await xr.isSessionSupported('immersive-ar'));
    } catch {
      ar = false;
    }
    if (ar) {
      start.disabled = false;
      status.textContent = 'Sit at a table with both hands free. No controllers needed.';
    } else {
      start.disabled = true;
      status.innerHTML =
        'Open this page in the <strong>Meta Quest Browser</strong> on Quest 3 or 3S to start. On a computer, <a href="?demo">watch the demo run in your browser</a>.';
    }
  };
  void check();

  start.addEventListener('click', () => {
    onGesture();
    world.launchXR();
  });
  world.visibilityState.subscribe((v) => {
    root.classList.toggle('hidden', v !== VisibilityState.NonImmersive);
  });
}
