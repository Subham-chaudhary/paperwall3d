/**
 * Robust WebGL2 context creation.
 *
 * Some GPU/driver/browser combinations (notably Firefox on Windows via ANGLE, which reports
 * `FEATURE_FAILURE_EGL_NO_CONFIG`) cannot satisfy every context attribute set. Instead of failing on the
 * first attempt, walk from the nicest attributes down to the most compatible ones, each on a fresh canvas
 * (a canvas whose getContext() failed is not reliably reusable). three.js (r163+) requires WebGL2.
 */

export class WebGLUnavailableError extends Error {
  /** Raw reasons reported by the browser for each attempt. */
  readonly reasons: string[];
  /** True if WebGL1 works but WebGL2 does not. */
  readonly webgl1Only: boolean;

  constructor(reasons: string[], webgl1Only: boolean) {
    super(webglHelp(webgl1Only));
    this.name = 'WebGLUnavailableError';
    this.reasons = reasons;
    this.webgl1Only = webgl1Only;
  }
}

/** Attribute sets tried in order: quality first, compatibility last. */
const ATTEMPTS: WebGLContextAttributes[] = [
  { antialias: true, alpha: false, powerPreference: 'high-performance' },
  { antialias: false, alpha: false, powerPreference: 'high-performance' },
  { antialias: false, alpha: false, powerPreference: 'default' },
  { antialias: false, alpha: false, powerPreference: 'low-power', stencil: false },
];

export interface CreatedContext {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  attributes: WebGLContextAttributes;
}

function tryCreate(attrs: WebGLContextAttributes, reasons: string[]): CreatedContext | null {
  const canvas = document.createElement('canvas');
  let reason = '';
  const onError = (e: Event): void => {
    reason = (e as WebGLContextEvent).statusMessage || reason;
  };
  canvas.addEventListener('webglcontextcreationerror', onError);
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { ...attrs, failIfMajorPerformanceCaveat: false });
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }
  canvas.removeEventListener('webglcontextcreationerror', onError);
  if (gl) return { canvas, gl, attributes: attrs };
  reasons.push(`${JSON.stringify(attrs)}: ${reason || 'getContext returned null'}`);
  return null;
}

function hasWebGL1(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl');
  } catch {
    return false;
  }
}

/** Create a WebGL2 context, falling back through simpler attribute sets. Throws WebGLUnavailableError. */
export function createWebGL2Context(): CreatedContext {
  const reasons: string[] = [];
  for (const attrs of ATTEMPTS) {
    const made = tryCreate(attrs, reasons);
    if (made) {
      if (reasons.length) console.warn('[PaperWall3D] WebGL2 needed fallback attributes:', made.attributes, reasons);
      return made;
    }
  }
  console.error('[PaperWall3D] WebGL2 unavailable:', reasons);
  throw new WebGLUnavailableError(reasons, hasWebGL1());
}

function webglHelp(webgl1Only: boolean): string {
  const what = webgl1Only
    ? 'Your browser has WebGL 1 but not WebGL 2, which the viewport needs.'
    : 'Your browser could not start WebGL (GPU acceleration is off, or the graphics driver is blocked).';
  return (
    `${what} The AI processing still works, but nothing can be drawn. ` +
    'Fix: in Firefox open Settings → General → Performance, untick "Use recommended performance settings" and tick ' +
    '"Use hardware acceleration when available", then restart Firefox (check about:support → "WebGL 2 Driver Renderer"). ' +
    'In Chrome or Edge enable Settings → System → "Use graphics acceleration when available". ' +
    'Updating your graphics driver, or trying Chrome/Edge, also usually fixes it.'
  );
}
