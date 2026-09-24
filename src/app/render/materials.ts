/**
 * Materials shared across the app. Skin uses wrap lighting and a soft rim to
 * read as flesh rather than plastic; everything else is matte and calm so the
 * real room stays the backdrop.
 */
import { Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from '@iwsdk/core';

/** Six skin tones, light to deep, plus a fine slider between them. */
export const SKIN_TONES = ['#f3d4c2', '#e5b89c', '#c99675', '#a8744f', '#7c5236', '#4e3322'];

export function skinColor(index: number): Color {
  const i = Math.max(0, Math.min(SKIN_TONES.length - 1.0001, index));
  const a = new Color(SKIN_TONES[Math.floor(i)]);
  const b = new Color(SKIN_TONES[Math.ceil(i)]);
  return a.lerp(b, i - Math.floor(i));
}

export function makeSkinMaterial(tone: number): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: skinColor(tone),
    roughness: 0.58,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new Color('#ffd9c6'),
    clearcoat: 0.08,
    clearcoatRoughness: 0.6,
  });
  m.onBeforeCompile = (shader) => {
    // wrap lighting: light bleeds past the terminator the way it does in skin
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      float wrapRim = pow(1.0 - saturate(dot(normalize(vViewPosition) * -1.0, normal)), 2.5);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.55, 0.22, 0.16) * 0.28;
      reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.55, 0.45) * wrapRim * 0.22;`,
    );
  };
  m.customProgramCacheKey = () => 'understudy-skin';
  return m;
}

export function makeGhostMaterial(color = '#bfe3ff', opacity = 0.28): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    emissive: new Color(color),
    emissiveIntensity: 0.35,
  });
}

/** Linen cloth that hides the real hand in passthrough. */
export function makeClothMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color('#e4d9c6'),
    roughness: 0.92,
    sheen: 1,
    sheenRoughness: 0.8,
    sheenColor: new Color('#fff8ee'),
    side: DoubleSide,
  });
}

export function unlit(color: string, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(color), transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

/** Palette. Lead is warm amber, Understudy is blue: distinct for all common colour-vision types. */
export const PALETTE = {
  lead: '#e8a33d',
  understudy: '#4c9be8',
  ink: '#1f2933',
  paper: '#f7f3ec',
  muted: '#6b7785',
  good: '#2f9e6e',
  caution: '#d9822b',
  mat: '#efe8dc',
};
