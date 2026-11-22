/** Texture helpers: ImageData / Float32 maps -> GPU textures with the right sampling state. */
import * as THREE from 'three';

/**
 * Colour texture from ImageData. Rows are NOT flipped: row 0 of the image is row 0 of the texture, so
 * meshes use v = 0 at the top of the image (also the glTF convention).
 *
 * `srgb: false` keeps the raw bytes (no decode on sampling). The 2D parallax shader blends in gamma space
 * exactly like 2.5dwallpp and writes raw values to the canvas; the 3D view and GLB use `srgb: true`.
 */
export function imageDataTexture(img: ImageData, maxAnisotropy: number, srgb: boolean): THREE.DataTexture {
  const bytes = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const tex = new THREE.DataTexture(bytes, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Single-channel half-float map (bilinear filterable on every WebGL2 device), clamped at the edges. */
export function depthTexture(depth: Float32Array, width: number, height: number): THREE.DataTexture {
  const half = new Uint16Array(depth.length);
  for (let i = 0; i < depth.length; i++) half[i] = THREE.DataUtils.toHalfFloat(depth[i]!);
  const tex = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
  tex.internalFormat = 'R16F';
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Opaque grayscale RGBA from a 0..1 map, optionally multiplied by a second 0..1 map (e.g. a mask). */
export function grayImage(values: Float32Array, width: number, height: number, weight?: Float32Array): ImageData {
  const out = new ImageData(width, height);
  const d = out.data;
  for (let i = 0; i < values.length; i++) {
    const v = Math.min(1, Math.max(0, values[i]! * (weight ? weight[i]! : 1)));
    const g = Math.round(v * 255);
    d[i * 4] = g;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = g;
    d[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Resize ImageData so neither side exceeds `maxSize` (high-quality canvas resampling, halving steps so no
 * pixels are skipped). Returns the input itself when it already fits.
 * Note: canvas works in premultiplied alpha, so very faint edge pixels of RGBA layers lose a little colour precision.
 */
export function fitImageData(img: ImageData, maxSize: number): ImageData {
  const k = Math.min(1, maxSize / Math.max(img.width, img.height));
  if (k >= 1) return img;
  const tw = Math.max(1, Math.floor(img.width * k));
  const th = Math.max(1, Math.floor(img.height * k));
  let cur = document.createElement('canvas');
  cur.width = img.width;
  cur.height = img.height;
  const first = cur.getContext('2d');
  if (!first) throw new Error('2D canvas unavailable');
  first.putImageData(img, 0, 0);
  while (cur.width > tw || cur.height > th) {
    const next = document.createElement('canvas');
    next.width = Math.max(tw, Math.ceil(cur.width / 2));
    next.height = Math.max(th, Math.ceil(cur.height / 2));
    const ctx = next.getContext('2d', { willReadFrequently: next.width === tw && next.height === th });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, tw, th);
}

/**
 * GPU colour textures keyed by the ImageData instance (and colour space), shared by the 2D and 3D views. As long as
 * a new scene carries the same ImageData objects (only maps changed) nothing is re-uploaded. Layers larger than
 * MAX_TEXTURE_SIZE are downscaled once, with a single console warning.
 */
export class ColorTextureCache {
  private readonly entries = new Map<ImageData, { raw?: THREE.DataTexture; srgb?: THREE.DataTexture }>();
  private warned = false;

  constructor(
    private readonly maxAnisotropy: number,
    private readonly maxTextureSize: number,
  ) {}

  /** `srgb: false` = raw bytes (2D parallax shader); `true` = decoded on sampling (3D view). */
  get(img: ImageData, srgb: boolean): THREE.DataTexture {
    let e = this.entries.get(img);
    if (!e) this.entries.set(img, (e = {}));
    const key = srgb ? 'srgb' : 'raw';
    let t = e[key];
    if (!t) {
      let src = img;
      if (Math.max(img.width, img.height) > this.maxTextureSize) {
        if (!this.warned) {
          this.warned = true;
          console.warn(
            `[PaperWall3D] Colour layer ${img.width}x${img.height} exceeds this GPU's MAX_TEXTURE_SIZE (${this.maxTextureSize}); downscaling it for display.`,
          );
        }
        // the downscaled copy is the same for both colour spaces
        const other = e[srgb ? 'raw' : 'srgb'];
        src = other ? (other.image as unknown as ImageData) : fitImageData(img, this.maxTextureSize);
      }
      t = imageDataTexture(src, this.maxAnisotropy, srgb);
      e[key] = t;
    }
    return t;
  }

  /** Free the GPU memory of every texture in the given colour space (they re-upload if used again). */
  release(srgb: boolean): void {
    for (const e of this.entries.values()) (srgb ? e.srgb : e.raw)?.dispose();
  }

  /** Keep only the textures of these images; dispose the rest. */
  retain(keep: Iterable<ImageData>): void {
    const set = new Set(keep);
    for (const [img, e] of this.entries) {
      if (set.has(img)) continue;
      e.raw?.dispose();
      e.srgb?.dispose();
      this.entries.delete(img);
    }
  }

  dispose(): void {
    this.retain([]);
  }
}
