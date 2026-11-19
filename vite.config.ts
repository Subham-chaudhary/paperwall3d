import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Cross-origin isolation enables SharedArrayBuffer → multi-threaded WASM inference.
// `credentialless` keeps CORS-enabled CDN fetches (Hugging Face model files) working.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
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
