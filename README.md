# PaperWall3D

Turn any photo or artwork into a depth-aware **3D parallax wallpaper**, entirely in your browser.

PaperWall3D runs AI models locally to find the main subject, estimate scene depth, separate the image into layers and rebuild it as lightweight 2.5D geometry. You tune depth, relief, segmentation, lighting and camera motion in a live 3D preview with a Blender-style interface, then export a GLB or a reusable wallpaper config.

**No server, no uploads.** Your images and the model inference stay on your device.

## How it works

| Step | What happens |
| --- | --- |
| **1. Image input** | Load a JPG, PNG or WebP (open, drag and drop, or a recent project). The image is resized to the working resolution. |
| **2. AI segmentation** | U²-NetP (fast, default) or U²-Net (full) finds the main subject and produces a foreground mask. |
| **3. Depth estimation** | Depth Anything V2 Small estimates relative depth for every pixel. A heuristic fallback keeps the app working offline. |
| **4. Reconstruction** | The mask is refined (threshold, grow/shrink, island removal, feather, edge snapping). The depth is refined (clip, contrast, gamma, edge-aware smoothing). The hole behind the subject is filled with multi-scale push-pull inpainting. |
| **5. 3D rendering** | Three.js builds two displaced meshes, an overscanned background and an elevated foreground, with lighting derived from depth. |
| **6. Interactive preview** | Moving the cursor drives camera parallax and tilt, and optionally the light direction. Orbit, auto-drift and static camera modes are also available. |
| **7. Export** | GLB with both layers and the camera, a PNG render (F12), or a `.pw3d.json` wallpaper config (optionally embedding the image, mask and depth). |

AI inference runs only while preparing the image. Moving the cursor never re-runs a model: slider changes only re-run the cheap post-processing (in a worker), and camera or lighting changes only touch the GPU.

## Features

- **Blender-style UI.** Dark theme, top bar with menus and workspaces (Layout, Segmentation, Depth, Shading, Export), toolbar, 3D viewport with a shading header and navigation gizmo, outliner, a properties editor with tabs and collapsible panels, an image editor strip with the pipeline layers, and a status bar with job progress.
- **Blender interactions.**
  - Drag sliders (Ctrl snaps to steps, Shift gives fine control), or click a slider to type a value.
  - Search all operators with **F3**, and switch view mode with the **Z pie menu**.
  - **N** toggles the sidebar.
  - Undo/redo with **Ctrl+Z** / **Ctrl+Shift+Z**.
- **View modes.** Rendered, depth (turbo colormap), mask, wireframe overlay, and an exploded *layers* view.
- **Projects.** Saved to IndexedDB with the analysis cached, so reopening a project skips the AI step.
- **Fullscreen preview.** **F11** or **Ctrl+Space** hides the UI so you can use the scene as a live wallpaper.

## Technology

| Area | Stack |
| --- | --- |
| AI inference | ONNX Runtime Web: WebGPU when available, otherwise multi-threaded WASM, in Web Workers |
| Segmentation | U²-NetP / U²-Net |
| Depth | Depth Anything V2 Small (fp16 on WebGPU, int8 on WASM) |
| Image processing | Canvas API and TypedArrays: separable blurs, morphology, connected components, guided filter, push-pull inpainting |
| 3D | Three.js, custom GLSL layer shaders, CPU-displaced geometry, GLTFExporter |
| Persistence | Cache Storage (model files), IndexedDB (projects and analysis), localStorage (UI layout and preferences) |
| Build | Vite and TypeScript (vanilla, no UI framework) |

### Models

Model weights are downloaded from the Hugging Face CDN the first time they are needed, then cached in the browser (Cache Storage). Nothing else is ever sent anywhere. You can see or clear the cache under **Properties › System › Models**.

| Model | Size | License |
| --- | --- | --- |
| U²-NetP (default) | ~4.6 MB | Apache-2.0 |
| U²-Net (optional) | ~176 MB | Apache-2.0 |
| Depth Anything V2 Small | ~27 MB (int8) / ~50 MB (fp16) | Apache-2.0 |

The ONNX Runtime WASM binaries are self-hosted with the app, so no third-party CDN is used for runtime code.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Requires Node 20 or newer. Use a recent Chromium, Firefox or Safari. WebGPU is optional; without it inference runs on WASM.

## Deploying to Netlify

The repo is ready for Netlify. `netlify.toml` sets the build command, the publish directory, and the cross-origin isolation headers (`COOP: same-origin`, `COEP: credentialless`) that multi-threaded WASM needs.

```bash
netlify init       # link or create a site
netlify deploy --build --prod
```

Or connect the repository in the Netlify dashboard; no extra settings are needed.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+O | Open image |
| Ctrl+S | Save project to the browser |
| Ctrl+Shift+S | Export wallpaper config |
| Ctrl+E | Export GLB |
| F12 | Render image (PNG) |
| Shift+R | Re-analyze |
| F3 | Operator search |
| Z / right-click | View-mode pie menu |
| N | Toggle sidebar |
| Home | Reset view |
| F11 / Ctrl+Space | Fullscreen preview |
| Alt+1…5 | Switch workspace |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

## Project structure

```
src/
  core/         shared contracts (types), settings store, defaults, events
  ai/           model registry, model cache, inference worker, pipeline facade
  imaging/      TypedArray image ops + reconstruction worker
  render/       Three.js renderer, displacement meshes, camera rig, export
  ui/           Blender-style shell, widgets, panels, menus, operators
  persistence/  IndexedDB projects, wallpaper config, preferences
  app.ts        orchestration: image → analyze → reconstruct → render
```

## Known limitations

- The inpainting fills smoothly, so it does not continue structures (planks, text) behind the subject. Large parallax can reveal the filled area.
- Depth is *relative* monocular depth, so it is shaped for perception rather than measurement.
- Mask brush editing is not available yet.

## License

MIT © subham-chaudhary. Model weights are under their own licenses (see above).
