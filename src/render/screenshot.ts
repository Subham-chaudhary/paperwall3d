/**
 * Still capture of the 2D parallax result: renders the view (current cursor state, cover-fit to the requested
 * aspect, no overlays) into an offscreen multisampled target and encodes it as PNG. The visible canvas and the
 * renderer's own state are untouched.
 */
import * as THREE from 'three';
import { PARALLAX_MAX_STEPS } from './parallaxShader';
import type { ParallaxFrame, ParallaxView } from './parallaxView';

export interface ScreenshotOptions {
  renderer: THREE.WebGLRenderer;
  view: ParallaxView;
  /** Frame to render; `vw`/`vh`/`fit`/`steps` are overridden (stills always march the full 48 steps). */
  frame: ParallaxFrame;
  /** Colour layer size (the output resolution): the default still size and the aspect. */
  colorWidth: number;
  colorHeight: number;
  width?: number;
  height?: number;
}

/** Still size: w/h when given (a missing side follows the colour aspect), else exactly the colour layers' size. */
export function resolveScreenshotSize(colorW: number, colorH: number, w?: number, h?: number): { w: number; h: number } {
  const aspect = colorW / colorH;
  if (w && h) return { w: Math.round(w), h: Math.round(h) };
  if (w) return { w: Math.round(w), h: Math.max(1, Math.round(w / aspect)) };
  if (h) return { w: Math.max(1, Math.round(h * aspect)), h: Math.round(h) };
  return { w: colorW, h: colorH };
}

export async function captureScreenshot(o: ScreenshotOptions): Promise<Blob> {
  const { renderer } = o;
  let { w, h } = resolveScreenshotSize(o.colorWidth, o.colorHeight, o.width, o.height);
  const max = Math.min(renderer.capabilities.maxTextureSize, 8192);
  const k = Math.min(1, max / Math.max(w, h));
  w = Math.max(1, Math.floor(w * k));
  h = Math.max(1, Math.floor(h * k));

  // The parallax shader writes raw (gamma-space) values, so the target must not be sRGB-encoded by the hardware.
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    samples: Math.min(4, renderer.capabilities.maxSamples),
    depthBuffer: false,
  });

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(w * h * 4);
  try {
    // The target is not colour managed: hand the renderer the sRGB numbers as if they were linear so they land unchanged.
    const raw = new THREE.Color(o.frame.settings.view.background).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    renderer.setClearColor(new THREE.Color().setRGB(raw.r, raw.g, raw.b, THREE.LinearSRGBColorSpace), 1);
    renderer.setRenderTarget(rt);
    o.view.render(renderer, { ...o.frame, vw: w, vh: h, fit: 'cover', steps: PARALLAX_MAX_STEPS, stage: 'result', picking: false });
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
  }

  // GL rows are bottom-up; flip into ImageData and force opaque alpha.
  const out = new Uint8ClampedArray(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * stride;
    out.set(pixels.subarray(src, src + stride), y * stride);
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}
