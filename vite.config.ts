import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Cross-origin isolation enables SharedArrayBuffer → multi-threaded WASM inference.
// `credentialless` keeps CORS-enabled CDN fetches (Hugging Face model files) working.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/**
 * Keeps every place that states the version in sync with package.json:
 * CHANGELOG.md must have a "## [x.y.z]" entry and the README badge must show x.y.z.
 * Fails production builds, warns in dev.
 */
function versionConsistency(): Plugin {
  let isBuild = false;
  return {
    name: 'paperwall3d-version-consistency',
    configResolved(c) {
      isBuild = c.command === 'build';
    },
    buildStart() {
      const v = pkg.version;
      const problems: string[] = [];
      const changelog = readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8');
      if (!changelog.includes(`## [${v}]`)) problems.push(`CHANGELOG.md has no "## [${v}]" entry`);
      const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
      const badge = readme.match(/badge\/version-([0-9.]+)-/);
      if (!badge || badge[1] !== v) problems.push(`README version badge says ${badge ? badge[1] : 'nothing'}, package.json says ${v}`);
      if (!problems.length) return;
      const msg = `Version mismatch:\n  - ${problems.join('\n  - ')}`;
      if (isBuild) this.error(msg);
      else this.warn(msg);
    },
  };
}

export default defineConfig({
  plugins: [versionConsistency()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
