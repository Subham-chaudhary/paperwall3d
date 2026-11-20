/**
 * Blender-style floor grid: fading minor/major lines on the XZ plane under the image,
 * with subtle red (X) and green (depth / Blender "Y") axis lines.
 */
import * as THREE from 'three';
import { GRID_FRAGMENT, GRID_VERTEX } from './shaders';

const HALF = 8; // world units from centre to edge
const STEP = 0.5;
const MAJOR_EVERY = 4;
export const GRID_FLOOR_Y = -1.25;

export function createGridHelper(): THREE.LineSegments {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();

  const push = (x0: number, z0: number, x1: number, z1: number, color: string, alpha: number): void => {
    c.set(color);
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
    ] as const) {
      pos.push(x, GRID_FLOOR_Y, z);
      // Radial fade so the grid dissolves toward the horizon.
      const fade = Math.pow(Math.max(0, 1 - Math.hypot(x, z) / (HALF * 1.05)), 0.6);
      col.push(c.r, c.g, c.b, alpha * fade);
    }
  };

  const lines = Math.round(HALF / STEP);
  for (let i = -lines; i <= lines; i++) {
    if (i === 0) continue;
    const major = i % MAJOR_EVERY === 0;
    const color = major ? '#9a9a9a' : '#7a7a7a';
    const alpha = major ? 0.9 : 0.6;
    const t = i * STEP;
    push(-HALF, t, HALF, t, color, alpha);
    push(t, -HALF, t, HALF, color, alpha);
  }
  push(-HALF, 0, HALF, 0, '#b84a4a', 0.75); // X axis
  push(0, -HALF, 0, HALF, '#5aa84f', 0.75); // depth axis

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(geo, mat);
  grid.name = 'Grid';
  grid.frustumCulled = false;
  grid.renderOrder = -1;
  grid.visible = false;
  return grid;
}

export function disposeGridHelper(grid: THREE.LineSegments): void {
  grid.geometry.dispose();
  (grid.material as THREE.Material).dispose();
}
