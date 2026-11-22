/**
 * Image decoding: validates the file, decodes with the browser's native decoder (respecting EXIF
 * orientation), downscales to the processing resolution and to the output (HD) resolution and returns RGBA pixels.
 */
import type { SourceImage } from '../core/types';

/** Reject anything larger than this many megapixels (decoding would likely exhaust memory). */
export const MAX_MEGAPIXELS = 40;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MIN_DIMENSION = 16;

type Format = 'jpeg' | 'png' | 'webp';

/** Identify the container from magic bytes (more reliable than the MIME type the OS reports). */
async function sniffFormat(file: Blob): Promise<Format | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  const tag = (o: number): string => String.fromCharCode(head[o]!, head[o + 1]!, head[o + 2]!, head[o + 3]!);
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'webp';
  return null;
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (err instanceof TypeError) return createImageBitmap(file); // options unsupported
    throw err;
  }
}

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: Canvas2D; ctx: Ctx2D } {
  let canvas: Canvas2D;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
  if (!ctx) throw new Error('Could not create a 2D canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/**
 * Draws `src` into a w x h canvas, over `background` when given (null keeps transparency).
 * Large reductions go through successive halvings, which keeps detail much better than one big step.
 */
function drawScaled(src: ImageBitmap, w: number, h: number, background: string | null): Ctx2D {
  let cur: CanvasImageSource = src;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h) {
    const nw = Math.max(w, Math.floor(cw / 2));
    const nh = Math.max(h, Math.floor(ch / 2));
    const step = makeCanvas(nw, nh);
    step.ctx.drawImage(cur, 0, 0, nw, nh);
    cur = step.canvas;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(w, h);
  if (background) {
    out.ctx.fillStyle = background;
    out.ctx.fillRect(0, 0, w, h);
  }
  out.ctx.drawImage(cur, 0, 0, w, h);
  return out.ctx;
}

/** Alpha channels of loaded images (0..1 at working resolution), only for images with meaningful transparency. */
const imageAlpha = new WeakMap<SourceImage, Float32Array>();

/** The image's own transparency as an object probability map, or undefined when it has none worth using. */
export function getImageAlpha(source: SourceImage): Float32Array | undefined {
  return imageAlpha.get(source);
}

/** More than this fraction of pixels with alpha < 250 counts as a meaningful alpha channel. */
const ALPHA_MIN_FRACTION = 0.005;

function extractAlpha(rgba: Uint8ClampedArray): Float32Array | null {
  const n = rgba.length / 4;
  let translucent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3]! < 250) translucent++;
  if (translucent <= n * ALPHA_MIN_FRACTION) return null;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rgba[i * 4 + 3]! / 255;
  return out;
}

/**
 * Decodes once and produces both resolutions: `pixels` at the processing resolution and `hd` at `outputLongEdge`
 * (the picture's own size capped there; never upscaled, never smaller than `pixels`). When both come out the same
 * size, `hd` is the same object as `pixels`.
 */
export async function loadSourceImage(
  file: Blob,
  name: string,
  workingResolution: number,
  outputLongEdge: number = workingResolution,
): Promise<SourceImage> {
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`The file is too large (${(file.size / 1048576).toFixed(0)} MB, max ${MAX_FILE_BYTES / 1048576} MB).`);
  }
  const format = await sniffFormat(file);
  if (!format) throw new Error('Unsupported file type. Please choose a JPG, PNG or WebP image.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error(`The ${format.toUpperCase()} image could not be decoded (corrupt or unsupported variant).`);
  }
  try {
    const ow = bitmap.width;
    const oh = bitmap.height;
    if (ow < MIN_DIMENSION || oh < MIN_DIMENSION) throw new Error(`The image is too small (${ow}x${oh}).`);
    if ((ow * oh) / 1e6 > MAX_MEGAPIXELS) {
      throw new Error(`The image is too large (${((ow * oh) / 1e6).toFixed(1)} MP, max ${MAX_MEGAPIXELS} MP).`);
    }
    const long = Math.max(ow, oh);
    // Downscale only: never upsample beyond the original.
    const scale = Math.min(1, workingResolution / long);
    const w = Math.max(1, Math.round(ow * scale));
    const h = Math.max(1, Math.round(oh * scale));
    // Output size: the processing size at least, the source size at most.
    const hdScale = Math.max(scale, Math.min(1, outputLongEdge / long));
    const hw = Math.max(w, Math.round(ow * hdScale));
    const hh = Math.max(h, Math.round(oh * hdScale));
    const sameSize = hw === w && hh === h;

    // Transparent images: composite over white (as 2.5dwallpp does) and remember a meaningful alpha channel
    // (detected at processing resolution).
    const alpha = format === 'jpeg' ? null : extractAlpha(drawScaled(bitmap, w, h, null).getImageData(0, 0, w, h).data);
    const pixels = drawScaled(bitmap, w, h, '#ffffff').getImageData(0, 0, w, h);
    const hd = sameSize ? pixels : drawScaled(bitmap, hw, hh, '#ffffff').getImageData(0, 0, hw, hh);
    const image: SourceImage = { name, originalWidth: ow, originalHeight: oh, width: w, height: h, pixels, hd, blob: file };
    if (alpha) imageAlpha.set(image, alpha);
    return image;
  } finally {
    bitmap.close();
  }
}
