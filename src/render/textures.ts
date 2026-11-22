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
