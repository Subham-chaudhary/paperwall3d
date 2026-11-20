/** Texture helpers: ImageData / Float32 depth maps -> GPU textures with the right sampling state. */
import * as THREE from 'three';

/**
 * sRGB colour texture from ImageData. Rows are NOT flipped: row 0 of the image is row 0 of
 * the texture, so meshes use v = 0 at the top of the image (this is also the glTF convention).
 * Mirrored wrapping lets the overscanned background plane extend past the image edges naturally.
 */
export function imageDataTexture(img: ImageData, maxAnisotropy: number, mirrored: boolean): THREE.DataTexture {
  const bytes = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const tex = new THREE.DataTexture(bytes, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = tex.wrapT = mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Single-channel half-float depth texture (bilinear filterable on every WebGL2 device). */
export function depthTexture(depth: Float32Array, width: number, height: number): THREE.DataTexture {
  const half = new Uint16Array(depth.length);
  for (let i = 0; i < depth.length; i++) half[i] = THREE.DataUtils.toHalfFloat(depth[i]!);
  const tex = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
  tex.internalFormat = 'R16F';
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.unpackAlignment = 1;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
