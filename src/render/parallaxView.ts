/**
 * 2D parallax wallpaper view: a port of 2.5dwallpp's viewer shader.
 *
 * Two draws of the same fragment shader, background opaque then object with premultiplied alpha. For each
 * screen pixel the shader ray-marches the layer's depth field (48 steps, 32 on big buffers, nearest to farthest, first hit wins,
 * linear refinement inside the last step) to find the texel a camera shift of `shift * (d - focus)` reveals.
 * The march is deliberately NOT alpha-aware: skipping transparent texels leaves a striped ghost of the object edge.
 *
 * The result is drawn on a quad that is tilted in 3D under a perspective camera (so tilt also works in
 * screenshots and the wallpaper preview, no CSS), in viewport-pixel scene units.
 */
import * as THREE from 'three';
import type { PreparedScene, Settings, StageView } from '../core/types';
import { colorSize, fitRect, perspectiveDistance, perspectiveFov, tiltCoverScale, type FitMode } from './layout';
import { PARALLAX_FRAG_COMMON } from './parallaxShader';
import { depthTexture, grayImage, imageDataTexture, type ColorTextureCache } from './textures';

const DEG = Math.PI / 180;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);            // (0,0) = top-left of the image, row 0 of the textures
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
#define SAMPLE_DEPTH(p) textureLod(uDepth, (p), 0.0)
#define SAMPLE_COLOR(p, uv) textureGrad(uColor, (p), dFdx(uv), dFdy(uv))   // footprint from the smooth, un-marched coordinate
${PARALLAX_FRAG_COMMON}`;

const FLAT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = vec4(texture(uTex, vUv).rgb, 1.0); }`;

export interface ParallaxFrame {
  settings: Settings;
  /** Smoothed cursor in 2.5dwallpp's convention: -1..1, y DOWN. */
  cur: { x: number; y: number };
  fit: FitMode;
  /** Ray-march steps (see marchSteps). */
  steps: number;
  /** Viewport (or render target) size in CSS px. */
  vw: number;
  vh: number;
  stage: StageView;
  picking: boolean;
  showBackground: boolean;
  showForeground: boolean;
}

type ColorKey = 'source' | 'bg' | 'fg';
type DepthKey = 'depth' | 'bgDepth' | 'fgDepth' | 'objDepth';

export class ParallaxView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
  private readonly bgMesh: THREE.Mesh;
  private readonly fgMesh: THREE.Mesh;
  private readonly flatMesh: THREE.Mesh;
  private readonly flatMat: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  private data: PreparedScene | null = null;
  private depths = new Map<DepthKey, THREE.Texture>();
  private stages = new Map<StageView, THREE.Texture>();

  constructor(
    private readonly maxAnisotropy: number,
    private readonly colorCache: ColorTextureCache,
  ) {
    this.bgMesh = new THREE.Mesh(this.geometry, this.layerMaterial(false));
    this.fgMesh = new THREE.Mesh(this.geometry, this.layerMaterial(true));
    this.flatMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FLAT_FRAG,
      uniforms: { uTex: { value: null } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flatMesh = new THREE.Mesh(this.geometry, this.flatMat);
    this.bgMesh.renderOrder = 0;
    this.fgMesh.renderOrder = 1;
    this.flatMesh.renderOrder = 2;
    for (const m of [this.bgMesh, this.fgMesh, this.flatMesh]) {
      m.frustumCulled = false;
      this.scene.add(m);
    }
  }

  setScene(scene: PreparedScene): void {
    this.disposeTextures();
    this.data = scene;
  }

  /** Draw into the renderer's current target (canvas or render target). */
  render(renderer: THREE.WebGLRenderer, f: ParallaxFrame): void {
    const sc = this.data;
    if (!sc) return;
    const { vw, vh } = f;
    const flat = f.picking || f.stage !== 'result';

    this.camera.fov = perspectiveFov(vh);
    this.camera.aspect = vw / vh;
    this.camera.near = 1;
    this.camera.far = perspectiveDistance(vh) * 4;
    this.camera.position.set(0, 0, perspectiveDistance(vh));
    this.camera.updateProjectionMatrix();

    if (flat) {
      // Static aid: untilted, unshifted, contain-fitted. Picking shows the source; stage overlays show their map.
      const cs = colorSize(sc);
      const rect = fitRect(vw, vh, cs.w, cs.h, 'contain');
      this.bgMesh.visible = this.fgMesh.visible = false;
      this.flatMesh.visible = true;
      this.flatMesh.scale.set(rect.w, rect.h, 1);
      this.flatMesh.rotation.set(0, 0, 0);
      this.flatMat.uniforms.uTex!.value = f.picking ? this.color('source') : this.stage(f.stage);
      renderer.render(this.scene, this.camera);
      return;
    }

    const P = f.settings.parallax;
    const L = f.settings.layers;
    // Fit/aspect follow the colour layers; the lighting gradient steps in MAP texels (uTexel).
    const cs = colorSize(sc);
    const iw = sc.width;
    const ih = sc.height;

    const rect = fitRect(vw, vh, cs.w, cs.h, f.fit);
    const rx = f.cur.y * P.tilt * DEG;
    const ry = f.cur.x * P.tilt * DEG;
    // A tilted cover-fit picture would show its edges: grow it just enough (wallpaper only).
    const grow = f.fit === 'cover' ? Math.max(1.001, tiltCoverScale(vw, vh, rect.w, rect.h, rx, ry, perspectiveDistance(vh)) * 1.001) : 1;

    const dir = P.inverse ? 1 : -1;
    const shiftX = f.cur.x * P.strength * dir;
    const shiftY = f.cur.y * P.strength * dir * (cs.w / cs.h);
    const zoom = 1 + P.strength * 1.6;
    const ldx = f.cur.x * 0.8;
    const ldy = f.cur.y * 0.8;

    const single = !sc.hasForeground;
    const subject = L.scope === 'subject';

    const setCommon = (m: THREE.Mesh): void => {
      m.scale.set(rect.w * grow, rect.h * grow, 1);
      m.rotation.set(rx, ry, 0, 'XYZ');
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uShift!.value.set(shiftX, shiftY);
      u.uLightDir!.value.set(ldx, ldy);
      u.uTexel!.value.set(1 / iw, 1 / ih);
      u.uFocus!.value = P.focus;
      u.uLight!.value = P.lighting;
      u.uZoom!.value = zoom;
      u.uSteps!.value = f.steps;
    };

    this.flatMesh.visible = false;
    this.bgMesh.visible = f.showBackground;
    this.fgMesh.visible = !single && f.showForeground;

    // Background (opaque). One layer without an object is the whole image with the whole-image depth.
    if (this.bgMesh.visible) {
      setCommon(this.bgMesh);
      const u = (this.bgMesh.material as THREE.ShaderMaterial).uniforms;
      u.uColor!.value = this.color(single ? 'source' : 'bg');
      u.uIsFg!.value = 0;
      u.uObjScale!.value = 1;
      u.uBase!.value = 0;
      u.uScale!.value = 1;
      u.uDepth!.value = this.depth(single ? 'depth' : 'bgDepth');
      if (!single && subject) {
        u.uFlat!.value = 1;
        u.uFlatDepth!.value = L.backgroundDepth;
      } else {
        u.uFlat!.value = 0;
        u.uFlatDepth!.value = 0;
      }
    }

    // Object (premultiplied alpha). Subject scope: depth = backgroundDepth + 0.1 + objDepth * relief.
    if (this.fgMesh.visible) {
      setCommon(this.fgMesh);
      const u = (this.fgMesh.material as THREE.ShaderMaterial).uniforms;
      u.uColor!.value = this.color('fg');
      u.uDepth!.value = this.depth(subject ? 'objDepth' : 'fgDepth');
      u.uIsFg!.value = 1;
      u.uFlat!.value = 0;
      u.uFlatDepth!.value = 0;
      u.uBase!.value = subject ? L.backgroundDepth + 0.1 : 0;
      u.uScale!.value = subject ? L.objectRelief : 1;
      u.uObjScale!.value = L.objectSize;
      u.uPivot!.value.set(sc.center[0], sc.center[1]);
    }

    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposeTextures();
    this.geometry.dispose();
    (this.bgMesh.material as THREE.Material).dispose();
    (this.fgMesh.material as THREE.Material).dispose();
    this.flatMat.dispose();
    this.data = null;
  }

  // ───────────────────────────────────────── internals ─────────────────────────────────────────

  private layerMaterial(premultiplied: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: null },
        uDepth: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2() },
        uLightDir: { value: new THREE.Vector2() },
        uPivot: { value: new THREE.Vector2(0.5, 0.5) },
        uFocus: { value: 0.5 },
        uLight: { value: 0 },
        uZoom: { value: 1 },
        uIsFg: { value: 0 },
        uFlat: { value: 0 },
        uFlatDepth: { value: 0 },
        uBase: { value: 0 },
        uScale: { value: 1 },
        uObjScale: { value: 1 },
        uSteps: { value: 48 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: premultiplied,
      blending: premultiplied ? THREE.CustomBlending : THREE.NoBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }

  private color(key: ColorKey): THREE.Texture {
    const sc = this.data!;
    return this.colorCache.get(key === 'source' ? sc.source : key === 'bg' ? sc.bgColor : sc.fg, false);
  }

  private depth(key: DepthKey): THREE.Texture {
    let t = this.depths.get(key);
    if (!t) {
      const sc = this.data!;
      t = depthTexture(sc[key], sc.width, sc.height);
      this.depths.set(key, t);
    }
    return t;
  }

  /** Static stage image: mask, object depth (masked to the object), or whole-image depth, as grayscale. */
  private stage(view: StageView): THREE.Texture {
    let t = this.stages.get(view);
    if (!t) {
      const sc = this.data!;
      const img =
        view === 'mask'
          ? grayImage(sc.mask, sc.width, sc.height)
          : view === 'objdepth'
            ? grayImage(sc.objDepth, sc.width, sc.height, sc.mask)
            : grayImage(sc.depth, sc.width, sc.height);
      t = imageDataTexture(img, this.maxAnisotropy, false);
      this.stages.set(view, t);
    }
    return t;
  }

  private disposeTextures(): void {
    for (const m of [this.depths, this.stages]) {
      for (const t of m.values()) t.dispose();
      m.clear();
    }
  }
}
