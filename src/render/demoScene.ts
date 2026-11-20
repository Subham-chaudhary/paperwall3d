/**
 * Procedural placeholder scene shown before the user loads an image:
 * a dusk landscape (gradient sky, sun, layered hills) with a lone tree as the foreground subject.
 * Everything is drawn with Canvas2D (source, background-without-subject, subject, depth) so it
 * takes a few tens of milliseconds and needs no assets.
 */
import type { PreparedScene } from '../core/types';

const W = 1024;
const H = 640;

type Ctx = CanvasRenderingContext2D;

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

const gray = (v: number): string => {
  const g = Math.round(Math.min(Math.max(v, 0), 1) * 255);
  return `rgb(${g},${g},${g})`;
};

interface Hill {
  base: number; // y of the ridge line centre
  amp: number;
  freq: number;
  phase: number;
  top: string;
  bottom: string;
  depth: number;
}

const HILLS: Hill[] = [
  { base: 0.5, amp: 0.05, freq: 1.3, phase: 0.4, top: '#6b4f8a', bottom: '#8a5f8e', depth: 0.12 },
  { base: 0.58, amp: 0.06, freq: 1.9, phase: 2.1, top: '#4f3f7a', bottom: '#6f4a80', depth: 0.24 },
  { base: 0.68, amp: 0.07, freq: 1.1, phase: 4.0, top: '#3a2f66', bottom: '#4f3a70', depth: 0.38 },
  { base: 0.79, amp: 0.05, freq: 2.3, phase: 1.2, top: '#271f4c', bottom: '#33275a', depth: 0.52 },
];

function ridge(h: Hill, nx: number): number {
  return (h.base + h.amp * Math.sin(nx * Math.PI * 2 * h.freq + h.phase) + h.amp * 0.45 * Math.sin(nx * Math.PI * 7.3 + h.phase * 1.7)) * H;
}

function hillPath(ctx: Ctx, h: Hill): void {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, ridge(h, x / W));
  ctx.lineTo(W, H);
  ctx.closePath();
}

/** Sky, sun and hills. `depthMode` renders the same shapes as a grayscale depth map. */
function drawBackdrop(ctx: Ctx, depthMode: boolean): void {
  if (depthMode) {
    ctx.fillStyle = gray(0);
    ctx.fillRect(0, 0, W, H);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#1b1b4a');
    sky.addColorStop(0.45, '#7a3f7e');
    sky.addColorStop(0.8, '#f08a6a');
    sky.addColorStop(1, '#ffd08a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    let seed = 7;
    for (let i = 0; i < 70; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = (seed / 2147483647) * W;
      seed = (seed * 16807) % 2147483647;
      const y = (seed / 2147483647) * H * 0.3;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Sun glow + disc.
    const sx = W * 0.68;
    const sy = H * 0.46;
    const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 230);
    glow.addColorStop(0, 'rgba(255,230,160,0.9)');
    glow.addColorStop(0.35, 'rgba(255,170,110,0.35)');
    glow.addColorStop(1, 'rgba(255,140,100,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff2c9';
    ctx.beginPath();
    ctx.arc(sx, sy, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const h of HILLS) {
    hillPath(ctx, h);
    if (depthMode) {
      // Nearer toward the bottom of each hill so the slopes read as ground.
      const g = ctx.createLinearGradient(0, h.base * H - h.amp * H, 0, H);
      g.addColorStop(0, gray(h.depth));
      g.addColorStop(1, gray(h.depth + 0.12));
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(0, h.base * H - h.amp * H, 0, H);
      g.addColorStop(0, h.top);
      g.addColorStop(1, h.bottom);
      ctx.fillStyle = g;
    }
    ctx.fill();
  }
}

/** Foreground subject: a mound with a lone round-canopy tree. Colour pass or depth pass. */
function drawSubject(ctx: Ctx, depthMode: boolean): void {
  const cx = W * 0.33;
  const groundY = H * 0.9;

  // Mound.
  ctx.beginPath();
  ctx.ellipse(cx, groundY, 210, 62, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  if (depthMode) {
    const g = ctx.createRadialGradient(cx, groundY, 10, cx, groundY, 210);
    g.addColorStop(0, gray(0.86));
    g.addColorStop(1, gray(0.7));
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, groundY - 62, 0, groundY);
    g.addColorStop(0, '#2f4a3a');
    g.addColorStop(1, '#16261f');
    ctx.fillStyle = g;
  }
  ctx.fill();

  // Trunk.
  ctx.beginPath();
  ctx.moveTo(cx - 16, groundY - 8);
  ctx.quadraticCurveTo(cx - 8, groundY - 120, cx - 26, groundY - 200);
  ctx.lineTo(cx + 26, groundY - 200);
  ctx.quadraticCurveTo(cx + 10, groundY - 120, cx + 20, groundY - 8);
  ctx.closePath();
  ctx.fillStyle = depthMode ? gray(0.8) : '#3a2a2a';
  ctx.fill();

  // Canopy: overlapping spheres, lit from the sun side.
  const blobs: [number, number, number][] = [
    [cx - 70, groundY - 240, 78],
    [cx + 72, groundY - 236, 82],
    [cx, groundY - 300, 98],
    [cx - 8, groundY - 220, 70],
  ];
  for (const [bx, by, r] of blobs) {
    const g = ctx.createRadialGradient(bx + r * 0.3, by - r * 0.3, r * 0.1, bx, by, r);
    if (depthMode) {
      g.addColorStop(0, gray(1));
      g.addColorStop(1, gray(0.72));
    } else {
      g.addColorStop(0, '#f2a15a');
      g.addColorStop(0.45, '#b8553f');
      g.addColorStop(1, '#4a1f3c');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const readPixels = (ctx: Ctx): ImageData => ctx.getImageData(0, 0, W, H);

/**
 * Spread RGB of opaque-ish pixels into fully transparent neighbours (a few passes) so
 * texture filtering at the silhouette never blends in black. Alpha is left untouched.
 */
function bleedEdges(img: ImageData, passes: number): void {
  const d = img.data;
  const w = img.width;
  const h = img.height;
  const done = new Uint8Array(w * h);
  for (let i = 0; i < done.length; i++) done[i] = d[i * 4 + 3]! > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const newly: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (done[i]) continue;
        const src = x > 0 && done[i - 1] ? i - 1 : x < w - 1 && done[i + 1] ? i + 1 : y > 0 && done[i - w] ? i - w : y < h - 1 && done[i + w] ? i + w : -1;
        if (src < 0) continue;
        d[i * 4] = d[src * 4]!;
        d[i * 4 + 1] = d[src * 4 + 1]!;
        d[i * 4 + 2] = d[src * 4 + 2]!;
        newly.push(i);
      }
    }
    for (const i of newly) done[i] = 1;
  }
}

/** Build the demo scene (~1024x640). Synchronous, typically 30-60 ms. */
export function createDemoScene(): PreparedScene {
  const t0 = performance.now();

  const bg = makeCanvas();
  drawBackdrop(bg.ctx, false);
  const background = readPixels(bg.ctx);

  // Subject alone on a transparent canvas -> foreground RGBA (straight alpha) and mask.
  const fgC = makeCanvas();
  drawSubject(fgC.ctx, false);
  const foreground = readPixels(fgC.ctx);
  bleedEdges(foreground, 3);

  // Composite = source.
  const srcC = makeCanvas();
  srcC.ctx.drawImage(bg.canvas, 0, 0);
  srcC.ctx.drawImage(fgC.canvas, 0, 0);
  const source = readPixels(srcC.ctx);

  // Depth: backdrop + subject rendered as grayscale.
  const dC = makeCanvas();
  drawBackdrop(dC.ctx, true);
  drawSubject(dC.ctx, true);
  const dPix = readPixels(dC.ctx).data;

  const n = W * H;
  const depth = new Float32Array(n);
  const mask = new Float32Array(n);
  const fgData = foreground.data;
  let any = false;
  for (let i = 0; i < n; i++) {
    depth[i] = dPix[i * 4]! / 255;
    const a = fgData[i * 4 + 3]! / 255;
    mask[i] = a;
    if (a > 0.5) any = true;
  }

  return {
    width: W,
    height: H,
    source,
    mask,
    depth,
    background,
    foreground,
    hasForeground: any,
    timings: { demo: performance.now() - t0 },
  };
}
