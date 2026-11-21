/**
 * CameraRig: parallax / orbit / auto / static camera behaviour.
 *
 * - Auto-fits the camera distance so the image plane *covers* the viewport at rest (wallpaper style).
 * - Pointer input is smoothed with a frame-rate independent exponential filter.
 * - Orbit mode handles its own pointer-drag + wheel events on the canvas.
 * - The "layers" exploded view is a blended extra yaw/pitch/dolly (see `layersBlend`).
 *
 * The rig is independent of three scene objects: `apply()` writes a pose onto any PerspectiveCamera
 * for any aspect ratio, which the screenshot and GLB exporter reuse.
 */
import * as THREE from 'three';
import type { CameraSettings } from '../core/types';

const DEG = Math.PI / 180;
/** World-unit camera translation per unit of parallax at full pointer deflection. */
const PARALLAX_UNITS = 0.12;
const ORBIT_YAW_LIMIT = 40;
const ORBIT_PITCH_LIMIT = 25;
const LAYERS_YAW = 28;
const LAYERS_PITCH = 12;
const LAYERS_DOLLY = 0.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Distance at which a plane of height 2 and width 2*imageAspect covers (fills, no bars) a viewport
 * of the given aspect. Visible height is 2·D·tan(fov/2) and visible width is that times viewAspect;
 * both must not exceed the plane, hence D = min(1, imageAspect/viewAspect) / tan(fov/2).
 */
export function fitDistance(fovDeg: number, viewAspect: number, imageAspect: number): number {
  const t = Math.tan((fovDeg * DEG) / 2);
  return Math.min(1, imageAspect / Math.max(viewAspect, 1e-3)) / t;
}

export class CameraRig {
  private s: CameraSettings;
  private imageAspect = 1.6;

  /** Raw pointer target (-1..1) from setPointer, pre-inversion. */
  private px = 0;
  private py = 0;
  /** Smoothed normalised offset (-1..1). */
  private cx = 0;
  private cy = 0;
  private autoT = 0;

  /** Orbit state (degrees): target and smoothed. */
  private oyT = 0;
  private opT = 0;
  private oy = 0;
  private op = 0;
  private ozT = 1;
  private oz = 1;

  private layersTarget = 0;
  private layersCur = 0;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private moving = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    settings: CameraSettings,
  ) {
    this.s = { ...settings };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setSettings(s: CameraSettings): void {
    if (s.mode !== this.s.mode) {
      // Leaving orbit/auto: relax back to the rest pose of the new mode.
      this.dragging = false;
      this.oyT = this.opT = 0;
      this.ozT = 1;
    }
    this.s = { ...s };
    this.moving = true;
  }

  setImageAspect(a: number): void {
    this.imageAspect = a;
  }

  /** Normalised pointer, -1..1, y up. */
  setPointer(x: number, y: number): void {
    this.px = clamp(x, -1, 1);
    this.py = clamp(y, -1, 1);
    this.moving = true;
  }

  setLayersView(on: boolean): void {
    this.layersTarget = on ? 1 : 0;
    this.moving = true;
  }

  /** 0 = normal, 1 = fully exploded. */
  get layersBlend(): number {
    return this.layersCur;
  }

  /** Smoothed pointer offset in -1..1 (for light steering). */
  get lightPointer(): { x: number; y: number } {
    return { x: this.cx, y: this.cy };
  }

  /** Snap back to the rest pose. */
  reset(): void {
    this.px = this.py = this.cx = this.cy = 0;
    this.oyT = this.opT = this.oy = this.op = 0;
    this.ozT = this.oz = 1;
    this.autoT = 0;
    this.moving = true;
  }

  /** Rest distance (zoom 1) used for perspective pre-compensation of baked geometry. */
  restDistance(viewAspect: number): number {
    return fitDistance(this.s.fov, viewAspect, this.imageAspect);
  }

  /** Advance smoothing. Returns true while anything is still animating (caller must keep rendering). */
  update(dt: number): boolean {
    const s = this.s;
    let tx = 0;
    let ty = 0;
    let continuous = false;

    switch (s.mode) {
      case 'cursor':
        tx = this.px * (s.invertX ? -1 : 1);
        ty = this.py * (s.invertY ? -1 : 1);
        break;
      case 'auto':
        this.autoT += dt * s.autoSpeed * 1.4;
        tx = Math.sin(this.autoT) * 0.85;
        ty = Math.sin(this.autoT * 0.67 + 1.3) * 0.6;
        continuous = s.autoSpeed > 0;
        break;
      default:
        break;
    }

    // Frame-rate independent exponential smoothing: damping is the per-frame (60 Hz) retention.
    const damp = clamp(s.damping, 0, 0.99);
    const a = 1 - Math.pow(damp, dt * 60);
    this.cx += (tx - this.cx) * a;
    this.cy += (ty - this.cy) * a;
    // Orbit & layers blend use a snappier filter so drags feel direct.
    const ao = 1 - Math.pow(Math.min(damp, 0.8), dt * 60);
    this.oy += (this.oyT - this.oy) * ao;
    this.op += (this.opT - this.op) * ao;
    this.oz += (this.ozT - this.oz) * ao;
    this.layersCur += (this.layersTarget - this.layersCur) * (1 - Math.pow(0.82, dt * 60));

    const eps = 5e-4;
    const settled =
      Math.abs(tx - this.cx) < eps &&
      Math.abs(ty - this.cy) < eps &&
      Math.abs(this.oyT - this.oy) < 0.01 &&
      Math.abs(this.opT - this.op) < 0.01 &&
      Math.abs(this.ozT - this.oz) < eps &&
      Math.abs(this.layersTarget - this.layersCur) < eps;
    if (settled) {
      this.cx = tx;
      this.cy = ty;
      this.oy = this.oyT;
      this.op = this.opT;
      this.oz = this.ozT;
      this.layersCur = this.layersTarget;
    }
    const wasMoving = this.moving;
    this.moving = !settled || continuous;
    // Render one more frame on the transition to settled so the final pose is drawn.
    return this.moving || wasMoving;
  }

  /** Write the current pose onto `camera` for a viewport of the given aspect ratio. */
  apply(camera: THREE.PerspectiveCamera, viewAspect: number): void {
    const s = this.s;
    const b = this.layersCur;
    camera.fov = s.fov;
    camera.aspect = viewAspect;
    camera.near = 0.05;
    camera.far = 200;
    camera.updateProjectionMatrix();

    let yaw = 0;
    let pitch = 0;
    let tX = 0;
    let tY = 0;
    let zoom = s.zoom;
    if (s.mode === 'orbit') {
      yaw = this.oy * DEG;
      pitch = this.op * DEG;
      zoom *= this.oz;
    } else {
      yaw = this.cx * s.tilt * DEG;
      pitch = this.cy * s.tilt * DEG;
      tX = this.cx * s.parallax * PARALLAX_UNITS;
      tY = this.cy * s.parallax * PARALLAX_UNITS;
    }
    yaw += b * LAYERS_YAW * DEG;
    pitch += b * LAYERS_PITCH * DEG;

    const dist = (fitDistance(s.fov, viewAspect, this.imageAspect) / zoom) * (1 + LAYERS_DOLLY * b);
    const cp = Math.cos(pitch);
    camera.position.set(Math.sin(yaw) * cp * dist + tX, Math.sin(pitch) * dist + tY, Math.cos(yaw) * cp * dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
  }

  // ───────────────────────────────────────── orbit input ─────────────────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    if (this.s.mode !== 'orbit' || e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging || this.s.mode !== 'orbit') return;
    const w = Math.max(this.canvas.clientWidth, 1);
    const h = Math.max(this.canvas.clientHeight, 1);
    const dx = (e.clientX - this.lastX) / w;
    const dy = (e.clientY - this.lastY) / h;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Dragging "grabs" the scene: drag right -> scene turns right -> camera yaws left.
    this.oyT = clamp(this.oyT - dx * 120, -ORBIT_YAW_LIMIT, ORBIT_YAW_LIMIT);
    this.opT = clamp(this.opT + dy * 90, -ORBIT_PITCH_LIMIT, ORBIT_PITCH_LIMIT);
    this.moving = true;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.s.mode !== 'orbit') return;
    e.preventDefault();
    this.ozT = clamp(this.ozT * Math.exp(-e.deltaY * 0.0012), 0.5, 2.5);
    this.moving = true;
  };
}
