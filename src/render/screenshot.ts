/**
 * Still capture: renders the live scene from the current camera pose into an offscreen,
 * multisampled render target at the requested size and encodes it as PNG.
 * The visible canvas and the renderer's own state are untouched.
 */
import * as THREE from 'three';
import type { CameraRig } from './cameraRig';

export interface ScreenshotOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rig: CameraRig;
  /** Source image aspect (width / height) for defaulting the output size. */
  imageAspect: number;
  width?: number;
  height?: number;
}

const DEFAULT_LONG_EDGE = 1920;

export function resolveScreenshotSize(imageAspect: number, w?: number, h?: number): { w: number; h: number } {
  if (w && h) return { w: Math.round(w), h: Math.round(h) };
  if (w) return { w: Math.round(w), h: Math.max(1, Math.round(w / imageAspect)) };
  if (h) return { w: Math.max(1, Math.round(h * imageAspect)), h: Math.round(h) };
  return imageAspect >= 1
    ? { w: DEFAULT_LONG_EDGE, h: Math.max(1, Math.round(DEFAULT_LONG_EDGE / imageAspect)) }
    : { w: Math.max(1, Math.round(DEFAULT_LONG_EDGE * imageAspect)), h: DEFAULT_LONG_EDGE };
}

export async function captureScreenshot(o: ScreenshotOptions): Promise<Blob> {
  const { renderer } = o;
  let { w, h } = resolveScreenshotSize(o.imageAspect, o.width, o.height);
  const max = Math.min(renderer.capabilities.maxTextureSize, 8192);
  const k = Math.min(1, max / Math.max(w, h));
  w = Math.max(1, Math.floor(w * k));
  h = Math.max(1, Math.floor(h * k));

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    samples: Math.min(4, renderer.capabilities.maxSamples),
    depthBuffer: true,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace; // makes the shaders encode to sRGB like the canvas

  const cam = new THREE.PerspectiveCamera();
  o.rig.apply(cam, w / h);

  const prevTarget = renderer.getRenderTarget();
  const pixels = new Uint8Array(w * h * 4);
  try {
    renderer.setRenderTarget(rt);
    renderer.render(o.scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  } finally {
    renderer.setRenderTarget(prevTarget);
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
