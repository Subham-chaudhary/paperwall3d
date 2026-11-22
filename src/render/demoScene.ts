/**
 * Procedural placeholder scene shown before the user loads an image, as a full 2.5dwallpp layer set:
 * the logo's world: electric-blue sky, hot-pink sun, neon-edged purple/navy mountain layers and a lone
 * pink tree on a dark mound as the foreground subject.
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
  /** Thin neon highlight traced along the ridge line. */
  rim: string;
  depth: number;
}

const HILLS: Hill[] = [
  { base: 0.5, amp: 0.05, freq: 1.3, phase: 0.4, top: '#8c2be6', bottom: '#6d1fc0', rim: '#2fe6ff', depth: 0.12 },
  { base: 0.58, amp: 0.06, freq: 1.9, phase: 2.1, top: '#14104a', bottom: '#0d0a33', rim: '#2fe6ff', depth: 0.24 },
  { base: 0.68, amp: 0.07, freq: 1.1, phase: 4.0, top: '#3d0d5e', bottom: '#2c0846', rim: '#e61ee8', depth: 0.38 },
  { base: 0.79, amp: 0.05, freq: 2.3, phase: 1.2, top: '#1d0a3d', bottom: '#14104a', rim: '#e61ee8', depth: 0.52 },
];

function ridge(h: Hill, nx: number): number {
  return (h.base + h.amp * Math.sin(nx * Math.PI * 2 * h.freq + h.phase) + h.amp * 0.45 * Math.sin(nx * Math.PI * 7.3 + h.phase * 1.7)) * H;
}

function ridgePath(ctx: Ctx, h: Hill): void {
  ctx.beginPath();
  ctx.moveTo(0, ridge(h, 0));
  for (let x = 4; x <= W; x += 4) ctx.lineTo(x, ridge(h, x / W));
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
    // Electric-blue sky with a gentle vertical variation.
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#0750d6');
    sky.addColorStop(0.55, '#0a6cff');
    sky.addColorStop(1, '#2f8fff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Flat hot-pink sun with a faint halo ring.
    const sx = W * 0.68;
    const sy = H * 0.33;
    ctx.fillStyle = 'rgba(255,60,158,0.16)';
    ctx.beginPath();
    ctx.arc(sx, sy, 74, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3c9e';
    ctx.beginPath();
    ctx.arc(sx, sy, 52, 0, Math.PI * 2);
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
    if (!depthMode) {
      ridgePath(ctx, h);
      ctx.strokeStyle = h.rim;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
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
    g.addColorStop(1, gray(0.78));
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, groundY - 62, 0, groundY);
    g.addColorStop(0, '#1a0a3a');
    g.addColorStop(1, '#0a0620');
    ctx.fillStyle = g;
  }
  ctx.fill();
  if (!depthMode) {
    ctx.beginPath();
    ctx.ellipse(cx, groundY, 210, 62, 0, Math.PI * 1.04, Math.PI * 1.96);
    ctx.strokeStyle = '#e61ee8';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Trunk.
  ctx.beginPath();
  ctx.moveTo(cx - 16, groundY - 8);
  ctx.quadraticCurveTo(cx - 8, groundY - 120, cx - 26, groundY - 200);
  ctx.lineTo(cx + 26, groundY - 200);
  ctx.quadraticCurveTo(cx + 10, groundY - 120, cx + 20, groundY - 8);
  ctx.closePath();
  ctx.fillStyle = depthMode ? gray(0.8) : '#6a0722';
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
      g.addColorStop(1, gray(0.86));
    } else {
      g.addColorStop(0, '#ff3c9e');
      g.addColorStop(0.45, '#ff1f6b');
      g.addColorStop(1, '#9a0b36');
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
  const bgColor = readPixels(bg.ctx);

  // Subject alone on a transparent canvas -> object RGBA (straight alpha, edge colours bled outward) and mask.
  const fgC = makeCanvas();
  fgC.ctx.filter = 'blur(1px)'; // feathered cut-out edge, like the pipeline's mask feather
  drawSubject(fgC.ctx, false);
  fgC.ctx.filter = 'none';
  const fg = readPixels(fgC.ctx);
  bleedEdges(fg, 3);

  // Composite = source.
  const srcC = makeCanvas();
  srcC.ctx.drawImage(bg.canvas, 0, 0);
  srcC.ctx.drawImage(fgC.canvas, 0, 0);
  const source = readPixels(srcC.ctx);

  // Whole-image depth (backdrop + subject) and the backdrop alone (the demo's "inpainted" background depth).
  const dC = makeCanvas();
  drawBackdrop(dC.ctx, true);
  const bgDepthPix = readPixels(dC.ctx).data;
  drawSubject(dC.ctx, true);
  const depthPix = readPixels(dC.ctx).data;

  // Subject depth alone, edge values bled outward (the demo's stand-in for the pipeline's rim fix, so the
  // object's silhouette is a clean depth cliff instead of a blurry ramp).
  const sdC = makeCanvas();
  drawSubject(sdC.ctx, true);
  const subjectDepth = readPixels(sdC.ctx);
  bleedEdges(subjectDepth, 3);
  const sdPix = subjectDepth.data;

  const n = W * H;
  const depth = new Float32Array(n);
  const bgDepth = new Float32Array(n);
  const mask = new Float32Array(n);
  const objDepth = new Float32Array(n);
  const fgData = fg.data;
  let lo = 1;
  let hi = 0;
  let cx = 0;
  let cy = 0;
  let area = 0;
  const objRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = depthPix[i * 4]! / 255;
    depth[i] = d;
    bgDepth[i] = bgDepthPix[i * 4]! / 255;
    const a = fgData[i * 4 + 3]! / 255;
    mask[i] = a;
    objRaw[i] = a > 0.01 ? sdPix[i * 4]! / 255 : d;
    if (a > 0.5) {
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      cx += i % W;
      cy += Math.floor(i / W);
      area++;
    }
  }
  // Object depth re-scaled to 0..1 inside the mask, 0 outside.
  const span = Math.max(hi - lo, 1e-3);
  for (let i = 0; i < n; i++) {
    if (mask[i]! > 0.01) objDepth[i] = Math.min(1, Math.max(0, (objRaw[i]! - lo) / span));
  }

  return {
    width: W,
    height: H,
    source,
    mask,
    depth,
    bgColor,
    bgDepth,
    fg,
    // Object depth in the true range (rim-fixed inside the mask, whole-image depth around it).
    fgDepth: objRaw,
    objDepth,
    center: area ? [cx / area / W, cy / area / H] : [0.5, 0.5],
    coverage: area / n,
    hasForeground: area > 0,
    timings: { demo: performance.now() - t0 },
  };
}
