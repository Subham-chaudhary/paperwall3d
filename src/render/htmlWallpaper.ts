/**
 * Live HTML wallpaper export: one self-contained .html file with the 2D parallax shader (raw WebGL1 for maximum
 * compatibility), the layer textures as data URIs and the current parallax/layers settings baked in. Cover-fit at
 * devicePixelRatio (capped at 2); input is the mouse, falling back to auto motion after ~4 s idle, plus
 * deviceorientation (gyro) on phones (iOS asks permission on the first tap); pauses while hidden; no external requests.
 *
 * The fragment shader, fit and tilt-cover maths are the very same sources the in-app view uses (parallaxShader.ts,
 * layout.ts), injected as text, so the two cannot drift.
 */
import type { PreparedScene, Settings } from '../core/types';
import { fitRect, tiltCoverScale } from './layout';
import { PARALLAX_FRAG_COMMON, PARALLAX_MAX_STEPS } from './parallaxShader';
import { encodePng, toBase64 } from './png';

interface Config {
  w: number;
  h: number;
  /** `single`: whole image with whole-image depth; `subject`: flat background + object relief; `all`: both depth maps. */
  mode: 'single' | 'subject' | 'all';
  parallax: { strength: number; focus: number; tilt: number; lighting: number; smoothing: number; inverse: boolean; autoMotion: boolean };
  layers: { backgroundDepth: number; objectSize: number; objectRelief: number; center: [number, number] };
  background: string;
  maxSteps: number;
  img: { bg: string; fg?: string; bgDepth?: string; fgDepth?: string };
}

const DATA_PNG = 'data:image/png;base64,';

const png = async (w: number, h: number, ch: 1 | 4, data: Uint8Array | Uint8ClampedArray): Promise<string> =>
  DATA_PNG + toBase64(await encodePng(w, h, ch, data));

function gray8(map: Float32Array): Uint8Array {
  const out = new Uint8Array(map.length);
  for (let i = 0; i < map.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, map[i]!)) * 255);
  return out;
}

function jpeg(img: ImageData, quality: number): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function buildHtmlWallpaper(scene: PreparedScene, settings: Settings, opts: { title?: string } = {}): Promise<Blob> {
  const { width: w, height: h } = scene;
  const single = !scene.hasForeground;
  const mode = single ? 'single' : settings.layers.scope;
  const img: Config['img'] = { bg: jpeg(single ? scene.source : scene.bgColor, 0.92) };
  if (single) {
    img.bgDepth = await png(w, h, 1, gray8(scene.depth));
  } else {
    img.fg = await png(w, h, 4, scene.fg.data);
    if (mode === 'subject') {
      img.fgDepth = await png(w, h, 1, gray8(scene.objDepth));
    } else {
      img.bgDepth = await png(w, h, 1, gray8(scene.bgDepth));
      img.fgDepth = await png(w, h, 1, gray8(scene.fgDepth));
    }
  }
  const P = settings.parallax;
  const L = settings.layers;
  const config: Config = {
    w,
    h,
    mode,
    parallax: { strength: P.strength, focus: P.focus, tilt: P.tilt, lighting: P.lighting, smoothing: P.smoothing, inverse: P.inverse, autoMotion: P.autoMotion },
    layers: { backgroundDepth: L.backgroundDepth, objectSize: L.objectSize, objectRelief: L.objectRelief, center: scene.center },
    background: settings.view.background,
    maxSteps: PARALLAX_MAX_STEPS,
    img,
  };
  const title = escapeHtml(opts.title?.trim() || 'PaperWall3D wallpaper');
  const bg = /^#[0-9a-f]{3,8}$/i.test(config.background) ? config.background : '#000';
  const parts: Record<string, string> = {
    TITLE: title,
    BG: bg,
    FIT: fitRect.toString(),
    COVER: tiltCoverScale.toString(),
    FRAG: JSON.stringify(PARALLAX_FRAG_COMMON),
    CONFIG: JSON.stringify(config),
  };
  const html = TEMPLATE.replace(/__([A-Z]+)__/g, (m, k: string) => parts[k] ?? m);
  return new Blob([html], { type: 'text/html' });
}

const TEMPLATE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>__TITLE__</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:__BG__}canvas{position:fixed;left:0;top:0;width:100%;height:100%;display:block}#m{position:fixed;left:16px;bottom:16px;color:#aaa;font:14px sans-serif}</style>
</head><body><canvas id="c"></canvas><div id="m"></div>
<script>
(function () {
'use strict';
var C = __CONFIG__;
var fitRect = __FIT__;
var tiltCoverScale = __COVER__;
var FRAG_COMMON = __FRAG__;
var DEG = Math.PI / 180;
var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
var canvas = document.getElementById('c');
var gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' }) ||
         canvas.getContext('experimental-webgl', { alpha: false });
if (!gl) { document.getElementById('m').textContent = 'WebGL is not available in this browser.'; return; }
canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
canvas.addEventListener('webglcontextrestored', function () { location.reload(); });

var VS = 'attribute vec2 aPos; uniform vec2 uView, uSize, uRot; uniform float uDist; varying vec2 vUv;' +
  'void main() { vUv = vec2(aPos.x + 0.5, 0.5 - aPos.y); vec3 p = vec3(aPos * uSize, 0.0);' +
  'float cy = cos(uRot.y), sy = sin(uRot.y), cx = cos(uRot.x), sx = sin(uRot.x);' +
  'p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);' +
  'p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);' +
  'gl_Position = vec4(p.x * 2.0 * uDist / uView.x, p.y * 2.0 * uDist / uView.y, 0.0, uDist - p.z); }';
var FS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\\nprecision highp float;\\n#else\\nprecision mediump float;\\n#endif\\n' +
  'varying vec2 vUv;\\n#define SAMPLE_DEPTH(p) texture2D(uDepth, (p))\\n#define SAMPLE_COLOR(p, uv) texture2D(uColor, (p))\\n' + FRAG_COMMON;

function shader(type, src) {
  var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
var prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
var aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
var locs = {};
function U(n) { return locs[n] === undefined ? (locs[n] = gl.getUniformLocation(prog, n)) : locs[n]; }
gl.uniform1i(U('uColor'), 0);
gl.uniform1i(U('uDepth'), 1);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
var bgc = (function () { var c = document.createElement('canvas').getContext('2d'); c.fillStyle = '__BG__'; c.fillRect(0, 0, 1, 1); var d = c.getImageData(0, 0, 1, 1).data; return [d[0] / 255, d[1] / 255, d[2] / 255]; })();
gl.clearColor(bgc[0], bgc[1], bgc[2], 1);

function texture(url) {
  return new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      resolve(t);
    };
    im.onerror = function () { reject(new Error('texture failed to decode')); };
    im.src = url;
  });
}

var vw = 1, vh = 1, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = window.innerWidth; vh = window.innerHeight;
  var max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  dpr = Math.max(0.25, Math.min(dpr, max / vw, max / vh));
  canvas.width = Math.max(1, Math.round(vw * dpr)); canvas.height = Math.max(1, Math.round(vh * dpr));
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// input: mouse, auto-motion fallback after ~4 s idle, gyro on phones
var P = C.parallax, L = C.layers;
var mx = 0, my = 0, lastInput = -1e9, cx = 0, cy = 0;
window.addEventListener('pointermove', function (e) {
  mx = clamp(e.clientX / window.innerWidth * 2 - 1, -1, 1); my = clamp(e.clientY / window.innerHeight * 2 - 1, -1, 1);
  lastInput = performance.now();
});
function onOrientation(e) {
  if (e.gamma == null || e.beta == null) return;
  var a = (screen.orientation && screen.orientation.angle) || window.orientation || 0, g = e.gamma, b = e.beta - 45;
  var x = g, y = b;
  if (a === 90) { x = b; y = -g; } else if (a === 270 || a === -90) { x = -b; y = g; }
  mx = clamp(x / 25, -1, 1); my = clamp(y / 25, -1, 1);
  lastInput = performance.now();
}
var asked = false;
function askGyro() {
  if (asked) return; asked = true;
  DeviceOrientationEvent.requestPermission().then(function (r) {
    if (r === 'granted') window.addEventListener('deviceorientation', onOrientation);
  }).catch(function () {});
}
if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
  window.addEventListener('touchend', askGyro, { once: true });
  window.addEventListener('click', askGyro, { once: true });
} else {
  window.addEventListener('deviceorientation', onOrientation);
}

var tex = {}, raf = 0, last = 0;
function layer(color, depth, isFg, scale, base, flatDepth) {
  var rect = fitRect(vw, vh, C.w, C.h, 'cover');
  var rx = cy * P.tilt * DEG, ry = cx * P.tilt * DEG, dist = 1.15 * vh;
  var grow = Math.max(1.001, tiltCoverScale(vw, vh, rect.w, rect.h, rx, ry, dist) * 1.001);
  var dir = P.inverse ? 1 : -1;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, color);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, depth);
  gl.uniform2f(U('uView'), vw, vh);
  gl.uniform2f(U('uSize'), rect.w * grow, rect.h * grow);
  gl.uniform2f(U('uRot'), rx, ry);
  gl.uniform1f(U('uDist'), dist);
  gl.uniform2f(U('uShift'), cx * P.strength * dir, cy * P.strength * dir * (C.w / C.h));
  gl.uniform2f(U('uLightDir'), cx * 0.8, cy * 0.8);
  gl.uniform2f(U('uTexel'), 1 / C.w, 1 / C.h);
  gl.uniform2f(U('uPivot'), L.center[0], L.center[1]);
  gl.uniform1f(U('uFocus'), P.focus);
  gl.uniform1f(U('uLight'), P.lighting);
  gl.uniform1f(U('uZoom'), 1 + P.strength * 1.6);
  gl.uniform1f(U('uIsFg'), isFg ? 1 : 0);
  gl.uniform1f(U('uFlat'), flatDepth === null ? 0 : 1);
  gl.uniform1f(U('uFlatDepth'), flatDepth === null ? 0 : flatDepth);
  gl.uniform1f(U('uBase'), base);
  gl.uniform1f(U('uScale'), scale);
  gl.uniform1f(U('uObjScale'), isFg ? L.objectSize : 1);
  gl.uniform1i(U('uSteps'), canvas.width * canvas.height > 4e6 ? 32 : C.maxSteps);
  if (isFg) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  var dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60; last = now;
  var auto = P.autoMotion || now - lastInput > 4000;
  var tx = auto ? Math.sin(now / 1800) * 0.8 : mx, ty = auto ? Math.cos(now / 2300) * 0.5 : my;
  var k = 1 - Math.pow(1 - clamp(P.smoothing, 0.001, 1), dt * 60);
  cx += (tx - cx) * k; cy += (ty - cy) * k;
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (C.mode === 'subject') {
    layer(tex.bg, tex.bg, false, 1, 0, L.backgroundDepth);
    layer(tex.fg, tex.fgDepth, true, L.objectRelief, L.backgroundDepth + 0.1, null);
  } else if (C.mode === 'all') {
    layer(tex.bg, tex.bgDepth, false, 1, 0, null);
    layer(tex.fg, tex.fgDepth, true, 1, 0, null);
  } else {
    layer(tex.bg, tex.bgDepth, false, 1, 0, null);
  }
}

function start() { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start();
});

var names = ['bg', 'fg', 'bgDepth', 'fgDepth'].filter(function (n) { return C.img[n]; });
Promise.all(names.map(function (n) { return texture(C.img[n]); })).then(function (ts) {
  names.forEach(function (n, i) { tex[n] = ts[i]; });
  start();
}).catch(function (e) { document.getElementById('m').textContent = String(e && e.message || e); });
})();
</script></body></html>
`;
