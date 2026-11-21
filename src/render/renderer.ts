/**
 * PaperRenderer: the IRenderer implementation. Owns the WebGLRenderer, scene graph, camera rig,
 * render loop (rAF, paused while the tab is hidden, frames only drawn when something changed or
 * the camera is still animating) and the diff-based settings application.
 *
 * Geometry displacement is CPU-side (see displacementMesh.ts): relief/elevation/scale/fov changes
 * only rewrite the position/normal typed arrays in place; topology is rebuilt only when
 * meshResolution, overscan or discontinuityCutoff change.
 */
import * as THREE from 'three';
import { cloneSettings, DEFAULT_SETTINGS } from '../core/defaults';
import type { IRenderer, PreparedScene, RenderStats, Settings } from '../core/types';
import { CameraRig } from './cameraRig';
import { exportLayersToGLB } from './exporter';
import { createGridHelper, disposeGridHelper } from './gridHelper';
import { SceneLayers } from './layers';
import { applyLighting, createSharedUniforms, type SharedUniforms } from './materials';
import { captureScreenshot } from './screenshot';
import { applyViewMode, isExploded } from './viewModes';

const FPS_TIME_CONSTANT = 0.5; // seconds

export class PaperRenderer implements IRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
  private readonly rig: CameraRig;
  private readonly shared: SharedUniforms = createSharedUniforms();
  private readonly grid = createGridHelper();
  private readonly resizeObserver: ResizeObserver;

  private layers: SceneLayers | null = null;
  private readonly layerVisible = { background: true, foreground: true };
  private settings: Settings = cloneSettings(DEFAULT_SETTINGS);
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
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Exposure is applied inside the layer shader; no global tone mapping so neutral settings reproduce the source.
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

    this.scene.add(this.grid);
    this.rig = new CameraRig(this.canvas, this.settings.camera);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resizeObserver = new ResizeObserver(() => this.syncSizeToContainer());
    this.resizeObserver.observe(container);

    this.applyNonGeometrySettings();
    this.syncSizeToContainer();
    this.start();
  }

  // ───────────────────────────────────────── IRenderer ─────────────────────────────────────────

  setScene(scene: PreparedScene, settings: Settings): void {
    this.settings = cloneSettings(settings);
    this.disposeLayers();
    const layers = new SceneLayers(scene, this.shared, this.renderer.capabilities.getMaxAnisotropy());
    this.layers = layers;
    this.applyLayerVisibility();
    this.scene.add(layers.group);
    this.rig.setImageAspect(layers.aspect);
    this.rig.setSettings(this.settings.camera);
    layers.update(this.settings.geometry, this.rig.restDistance(this.aspect()));
    this.applyNonGeometrySettings();
    this.dirty = true;
  }

  updateSettings(next: Settings): void {
    this.settings = cloneSettings(next);
    this.rig.setSettings(this.settings.camera);
    this.layers?.update(this.settings.geometry, this.rig.restDistance(this.aspect()));
    this.applyNonGeometrySettings();
    this.dirty = true;
  }

  setPointer(x: number, y: number): void {
    this.rig.setPointer(x, y);
  }

  resize(width: number, height: number): void {
    this.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  resetView(): void {
    this.rig.reset();
    this.dirty = true;
  }

  setLayerVisibility(layer: 'background' | 'foreground', visible: boolean): void {
    this.layerVisible[layer] = visible;
    this.applyLayerVisibility();
    this.dirty = true;
  }

  private applyLayerVisibility(): void {
    if (!this.layers) return;
    this.layers.background.object.visible = this.layerVisible.background;
    if (this.layers.foreground) this.layers.foreground.object.visible = this.layerVisible.foreground;
  }

  getStats(): RenderStats {
    return { ...this.stats, fps: this.fps };
  }

  async exportGLB(): Promise<Blob> {
    if (!this.layers) throw new Error('No scene loaded');
    // Rest pose camera: zoom/pointer/orbit ignored, centred on the image.
    const cam = new THREE.PerspectiveCamera(this.settings.camera.fov, this.aspect(), 0.05, 200);
    cam.position.set(0, 0, this.rig.restDistance(this.aspect()));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return exportLayersToGLB(this.layers, cam);
  }

  async screenshot(width?: number, height?: number): Promise<Blob> {
    const wasGrid = this.grid.visible;
    this.grid.visible = false;
    try {
      this.prepareFrame();
      return await captureScreenshot({
        renderer: this.renderer,
        scene: this.scene,
        rig: this.rig,
        imageAspect: this.layers?.aspect ?? this.aspect(),
        width,
        height,
      });
    } finally {
      this.grid.visible = wasGrid;
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
    this.rig.dispose();
    this.disposeLayers();
    this.scene.remove(this.grid);
    disposeGridHelper(this.grid);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // ───────────────────────────────────────── internals ─────────────────────────────────────────

  private aspect(): number {
    return this.width / this.height;
  }

  private disposeLayers(): void {
    if (!this.layers) return;
    this.scene.remove(this.layers.group);
    this.layers.dispose();
    this.layers = null;
  }

  private syncSizeToContainer(): void {
    const w = Math.max(1, Math.round(this.container.clientWidth));
    const h = Math.max(1, Math.round(this.container.clientHeight));
    this.setSize(w, h);
  }

  private setSize(w: number, h: number): void {
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    const aspectChanged = w / h !== this.aspect();
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    // The cover-fit distance depends on the viewport aspect, so perspective pre-compensation must follow.
    if (aspectChanged) this.layers?.update(this.settings.geometry, this.rig.restDistance(this.aspect()));
    this.dirty = true;
  }

  /** Everything except geometry: lighting, view mode, background, grid. */
  private applyNonGeometrySettings(): void {
    const s = this.settings;
    this.renderer.setClearColor(new THREE.Color(s.view.background), 1);
    this.grid.visible = s.view.showGrid;
    applyViewMode(s.view.mode, this.shared, this.layers);
    this.rig.setLayersView(isExploded(s.view.mode));
    const p = this.rig.lightPointer;
    applyLighting(this.shared, s.lighting, p.x, p.y);
  }

  /** Per-frame state that depends on the rig: light steering and exploded offsets. */
  private prepareFrame(): void {
    const p = this.rig.lightPointer;
    applyLighting(this.shared, this.settings.lighting, p.x, p.y);
    this.layers?.setExplode(this.rig.layersBlend);
    this.rig.apply(this.camera, this.aspect());
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

    const animating = this.rig.update(dt);
    if (this.contextLost || !(this.dirty || animating)) return;
    this.dirty = false;

    this.prepareFrame();
    this.renderer.render(this.scene, this.camera);

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
