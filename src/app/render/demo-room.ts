/**
 * The room shown in emulation: a quiet study with a desk, a window and soft
 * daylight. On a headset the user's own room is the backdrop; in the browser
 * demo this stands in for it. Everything is procedural, so the demo needs no
 * downloads.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { rng } from '../../core/math.js';

function tex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = [1, 1]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function woodTexture(base: string, dark: string, seed: number, repeat: number[]): CanvasTexture {
  return tex(
    512,
    512,
    (ctx, w, h) => {
      const r = rng(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const y = r() * h;
        ctx.strokeStyle = dark;
        ctx.globalAlpha = 0.05 + r() * 0.12;
        ctx.lineWidth = 1 + r() * 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.015 + i) * (3 + r() * 5));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    repeat,
  );
}

function plasterTexture(): CanvasTexture {
  return tex(
    256,
    256,
    (ctx, w, h) => {
      const r = rng(5);
      ctx.fillStyle = '#ece6dc';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const l = 215 + Math.floor(r() * 30);
        ctx.fillStyle = `rgba(${l},${l - 4},${l - 12},0.25)`;
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
    },
    [4, 2],
  );
}

export interface RoomLayout {
  /** Desk top centre; the desk surface is at `deskTop[1]`. */
  deskTop: [number, number, number];
}

export function buildDemoRoom(layout: RoomLayout): Group {
  const g = new Group();
  g.name = 'demo-room';
  const [dx, dy, dz] = layout.deskTop;

  const floor = new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ map: woodTexture('#b88a5e', '#6b4a2e', 3, [6, 6]), roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const wallMat = new MeshStandardMaterial({ map: plasterTexture(), roughness: 0.95 });
  const back = new Mesh(new PlaneGeometry(6, 2.8), wallMat);
  back.position.set(0, 1.4, dz - 1.1);
  g.add(back);
  const left = new Mesh(new PlaneGeometry(4, 2.8), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-2.2, 1.4, dz + 0.9);
  g.add(left);
  const right = new Mesh(new PlaneGeometry(4, 2.8), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(2.4, 1.4, dz + 0.9);
  g.add(right);

  // window on the back wall, left of the desk, with a daylight glow
  const windowGlow = new Mesh(
    new PlaneGeometry(1.1, 1.3),
    new MeshStandardMaterial({ color: new Color('#dcebf5'), emissive: new Color('#eaf3fb'), emissiveIntensity: 1.1 }),
  );
  windowGlow.position.set(dx - 0.9, 1.55, dz - 1.09);
  g.add(windowGlow);
  const frameMat = new MeshStandardMaterial({ color: new Color('#f4f1ea'), roughness: 0.6 });
  for (const [w, h, x, y] of [
    [1.2, 0.06, 0, 0.68],
    [1.2, 0.06, 0, -0.68],
    [0.06, 1.4, 0.58, 0],
    [0.06, 1.4, -0.58, 0],
    [0.04, 1.3, 0, 0],
  ]) {
    const m = new Mesh(new BoxGeometry(w, h, 0.05), frameMat);
    m.position.set(dx - 0.9 + x, 1.55 + y, dz - 1.07);
    g.add(m);
  }

  // desk
  const deskMat = new MeshStandardMaterial({ map: woodTexture('#c9a47a', '#8a6440', 9, [1, 1]), roughness: 0.55 });
  const top = new Mesh(new BoxGeometry(1.5, 0.035, 0.78), deskMat);
  top.position.set(dx, dy - 0.0175, dz);
  g.add(top);
  const legMat = new MeshStandardMaterial({ color: new Color('#3b3833'), roughness: 0.5, metalness: 0.3 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new Mesh(new BoxGeometry(0.04, dy - 0.035, 0.04), legMat);
      leg.position.set(dx + sx * 0.7, (dy - 0.035) / 2, dz + sz * 0.34);
      g.add(leg);
    }

  // a lamp, a plant and books on the desk's far edge
  const lampBase = new Mesh(new CylinderGeometry(0.07, 0.08, 0.02, 32), legMat);
  lampBase.position.set(dx + 0.58, dy + 0.01, dz - 0.25);
  g.add(lampBase);
  const lampPole = new Mesh(new CylinderGeometry(0.008, 0.008, 0.38, 12), legMat);
  lampPole.position.set(dx + 0.58, dy + 0.2, dz - 0.25);
  g.add(lampPole);
  const shade = new Mesh(
    new CylinderGeometry(0.06, 0.11, 0.12, 32, 1, true),
    new MeshStandardMaterial({ color: new Color('#f3e7d3'), emissive: new Color('#ffe0b0'), emissiveIntensity: 0.35, side: 2 }),
  );
  shade.position.set(dx + 0.58, dy + 0.42, dz - 0.25);
  g.add(shade);
  const pot = new Mesh(new CylinderGeometry(0.06, 0.05, 0.11, 24), new MeshStandardMaterial({ color: new Color('#c56b4a'), roughness: 0.8 }));
  pot.position.set(dx - 0.6, dy + 0.055, dz - 0.26);
  g.add(pot);
  const leafMat = new MeshStandardMaterial({ color: new Color('#4f7a4a'), roughness: 0.7 });
  const r = rng(12);
  for (let i = 0; i < 9; i++) {
    const leaf = new Mesh(new SphereGeometry(0.045, 12, 8), leafMat);
    leaf.scale.set(0.6, 1.4, 0.35);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(dx - 0.6 + Math.cos(a) * 0.035, dy + 0.17 + r() * 0.06, dz - 0.26 + Math.sin(a) * 0.035);
    leaf.rotation.set((r() - 0.5) * 0.8, a, Math.cos(a) * 0.5);
    g.add(leaf);
  }
  const bookColors = ['#6d8fb5', '#c9a24a', '#a45a52', '#5f8a73'];
  bookColors.forEach((c, i) => {
    const b = new Mesh(new BoxGeometry(0.03, 0.2 + i * 0.012, 0.15), new MeshStandardMaterial({ color: new Color(c), roughness: 0.7 }));
    b.position.set(dx + 0.3 + i * 0.033, dy + 0.1 + i * 0.006, dz - 0.3);
    g.add(b);
  });

  // daylight from the window and a warm sky/ground fill
  const sun = new DirectionalLight(0xfff4e6, 1.1);
  sun.position.set(dx - 1.4, 2.6, dz - 1.6);
  sun.target.position.set(dx, dy, dz);
  g.add(sun, sun.target);
  g.add(new HemisphereLight(0xf6f1ea, 0x8a6b52, 0.55));
  return g;
}
