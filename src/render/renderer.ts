/**
 * PaperRenderer: the IRenderer implementation. Owns the WebGLRenderer, the two views (2D parallax wallpaper,
 * 3D orbit), the render loop (rAF, paused while the tab is hidden, frames only drawn when something changed or
 * is still animating) and the settings application.
 *
 * Pointer convention: `setPointer` takes y UP (-1..1); internally the cursor follows 2.5dwallpp (y down).
 */
import * as THREE from 'three';
import { cloneSettings, DEFAULT_SETTINGS } from '../core/defaults';
import type { IRenderer, PreparedScene, Presentation, RenderStats, Settings } from '../core/types';
import { exportSceneToGLB } from './exporter';
import { createWebGL2Context } from './glContext';
import { buildHtmlWallpaper } from './htmlWallpaper';
import { fitRect, type FitMode } from './layout';
import { OrbitView } from './orbitView';
import { marchSteps } from './parallaxShader';
import { ParallaxView, type ParallaxFrame } from './parallaxView';
import { captureScreenshot } from './screenshot';

const FPS_TIME_CONSTANT = 0.5; // seconds
const CURSOR_EPS = 1e-4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export class PaperRenderer implements IRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly parallax: ParallaxView;
  private readonly orbit: OrbitView;
  private readonly resizeObserver: ResizeObserver;

  private scene: PreparedScene | null = null;
  private settings: Settings = cloneSettings(DEFAULT_SETTINGS);
  private readonly layerVisible = { background: true, foreground: true };
  private presentation: Presentation = 'editor';
  private picking = false;

  /** Pointer target and smoothed cursor, -1..1, y down (2.5dwallpp convention). */
  private readonly mouse = { x: 0, y: 0 };
  private readonly cur = { x: 0, y: 0 };

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private rafId = 0;
  private lastTime = 0;
  private fps = 60;
  private dirty = true;
  private disposed = false;
  private contextLost = false;
  private stats: RenderStats = { fps: 0, triangles: 0, drawCalls: 0, textures: 0, gpu: 'WebGL2' };
  private gpuName = 'WebGL2';

  constructor(container: HTMLElement) {
    this.container = container;
    // Falls back through simpler context attributes; throws WebGLUnavailableError with fix-it guidance.
    const created = createWebGL2Context();
    this.canvas = created.canvas;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: created.gl,
      antialias: created.attributes.antialias,
      alpha: false,
      powerPreference: created.attributes.powerPreference,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;

    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      this.gpuName = name || 'WebGL2';
    } catch {
      /* keep default */
    }

    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.parallax = new ParallaxView(aniso);
    this.orbit = new OrbitView(aniso);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resizeObserver = new ResizeObserver(() => this.syncSizeToContainer());
    this.resizeObserver.observe(container);

    this.applySettings();
    this.syncSizeToContainer();
    this.start();
  }

  // ───────────────────────────────────────── IRenderer ─────────────────────────────────────────

  setScene(scene: PreparedScene, settings: Settings): void {
    this.settings = cloneSettings(settings);
    this.scene = scene;
    this.parallax.setScene(scene);
    this.orbit.setScene(scene);
    this.applySettings();
  }

  updateSettings(next: Settings): void {
    this.settings = cloneSettings(next);
    this.applySettings();
  }

  setPointer(x: number, y: number): void {
    this.mouse.x = clamp(x, -1, 1);
    this.mouse.y = clamp(-y, -1, 1);
  }

  resize(width: number, height: number): void {
    this.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  resetView(): void {
    this.orbit.resetCamera();
    this.cur.x = this.mouse.x;
    this.cur.y = this.mouse.y;
    this.dirty = true;
  }

  setLayerVisibility(layer: 'background' | 'foreground', visible: boolean): void {
    this.layerVisible[layer] = visible;
    this.applySettings();
  }

  setPresentation(mode: Presentation): void {
    this.presentation = mode;
    this.applySettings();
  }

  setPicking(on: boolean): void {
    this.picking = on;
    this.applySettings();
  }

  imagePointAt(clientX: number, clientY: number): [number, number] | null {
    if (!this.scene || this.settings.view.mode !== '2d') return null;
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    const rect = fitRect(box.width, box.height, this.scene.width, this.scene.height, this.fit());
    const u = (clientX - box.left - rect.x) / rect.w;
    const v = (clientY - box.top - rect.y) / rect.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
  }

  getStats(): RenderStats {
    return { ...this.stats, fps: this.fps };
  }

  async exportGLB(): Promise<Blob> {
    if (!this.scene) throw new Error('No scene loaded');
    return exportSceneToGLB(this.scene, this.settings, {
      showBackground: this.settings.camera3d.showbg,
      showForeground: this.scene.hasForeground,
    });
  }

  async exportHTML(options?: { title?: string }): Promise<Blob> {
    if (!this.scene) throw new Error('No scene loaded');
    return buildHtmlWallpaper(this.scene, this.settings, options);
  }

  async screenshot(width?: number, height?: number): Promise<Blob> {
    if (!this.scene) throw new Error('No scene loaded');
    try {
      return await captureScreenshot({
        renderer: this.renderer,
        view: this.parallax,
        frame: this.frameState(),
        imageAspect: this.scene.width / this.scene.height,
        width,
        height,
      });
    } finally {
      this.dirty = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.orbit.dispose();
    this.parallax.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // ───────────────────────────────────────── internals ─────────────────────────────────────────

  /** Flat aids (picking, stage overlays) are always contain-fitted; the live result follows the presentation. */
  private fit(): FitMode {
    if (this.picking || this.settings.view.stage !== 'result') return 'contain';
    return this.presentation === 'wallpaper' ? 'cover' : 'contain';
  }

  private frameState(): ParallaxFrame {
    return {
      settings: this.settings,
      cur: this.cur,
      fit: this.fit(),
      steps: marchSteps(this.width * this.height * this.pixelRatio * this.pixelRatio),
      vw: this.width,
      vh: this.height,
      stage: this.settings.view.stage,
      picking: this.picking,
      showBackground: this.layerVisible.background,
      showForeground: this.layerVisible.foreground,
    };
  }

  private syncSizeToContainer(): void {
    const w = Math.max(1, Math.round(this.container.clientWidth));
    const h = Math.max(1, Math.round(this.container.clientHeight));
    this.setSize(w, h);
  }

  private setSize(w: number, h: number): void {
    // devicePixelRatio capped at 2, and the drawing buffer kept within MAX_TEXTURE_SIZE
    const maxBuffer = this.renderer.capabilities.maxTextureSize;
    const pr = Math.max(0.25, Math.min(window.devicePixelRatio || 1, 2, maxBuffer / w, maxBuffer / h));
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.orbit.resize(w, h);
    this.dirty = true;
  }

  /** Push current settings into the active view. */
  private applySettings(): void {
    const s = this.settings;
    this.renderer.setClearColor(new THREE.Color(s.view.background), 1);
    if (s.view.mode === '3d') {
      this.orbit.setActive(this.canvas);
      this.orbit.sync({
        settings: s,
        showBackground: this.layerVisible.background,
        showForeground: this.layerVisible.foreground,
        showGrid: this.presentation === 'editor',
      });
    } else {
      this.orbit.setActive(null);
    }
    this.dirty = true;
  }

  /** Cursor follow: frame-rate independent lerp toward the pointer (or the auto-motion path). True if it moved. */
  private stepCursor(now: number, dt: number): boolean {
    const P = this.settings.parallax;
    if (P.autoMotion) {
      this.mouse.x = Math.sin(now / 1800) * 0.8;
      this.mouse.y = Math.cos(now / 2300) * 0.5;
    }
    const still = this.picking || this.settings.view.stage !== 'result'; // keep the picture steady while picking
    const tx = still ? 0 : this.mouse.x;
    const ty = still ? 0 : this.mouse.y;
    const k = 1 - Math.pow(1 - clamp(P.smoothing, 0.001, 1), dt * 60);
    const px = this.cur.x;
    const py = this.cur.y;
    this.cur.x += (tx - px) * k;
    this.cur.y += (ty - py) * k;
    if (Math.abs(tx - this.cur.x) < CURSOR_EPS) this.cur.x = tx;
    if (Math.abs(ty - this.cur.y) < CURSOR_EPS) this.cur.y = ty;
    return this.cur.x !== px || this.cur.y !== py;
  }

  private start(): void {
    if (this.rafId || this.disposed) return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 1 / 60;
    this.lastTime = now;

    // Smoothed frame rate from rAF cadence (equals the achieved fps when rendering every frame).
    if (dt > 0) this.fps += (1 / dt - this.fps) * (1 - Math.exp(-dt / FPS_TIME_CONSTANT));

    const mode = this.settings.view.mode;
    if (mode === 'config' || this.contextLost) return;
    const animating = mode === '3d' ? this.orbit.update(dt) : this.stepCursor(now, dt);
    if (!(this.dirty || animating)) return;
    this.dirty = false;

    if (mode === '3d') this.orbit.render(this.renderer);
    else this.parallax.render(this.renderer, this.frameState());

    const info = this.renderer.info;
    this.stats = {
      fps: this.fps,
      triangles: info.render.triangles,
      drawCalls: info.render.calls,
      textures: info.memory.textures,
      gpu: this.gpuName,
    };
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    } else {
      this.dirty = true;
      this.start();
    }
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault(); // allow restoration
    this.contextLost = true;
    console.warn('[PaperWall3D] WebGL context lost; waiting for restore');
  };

  private readonly onContextRestored = (): void => {
    console.info('[PaperWall3D] WebGL context restored');
    this.contextLost = false;
    // three.js re-creates GPU resources lazily from the CPU-side textures/geometries.
    this.dirty = true;
  };
}
