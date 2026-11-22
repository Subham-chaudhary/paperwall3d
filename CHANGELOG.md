# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-22

The workflow, options and layer model now follow the sibling project 2.5dwallpp, while keeping the Blender-style UI.

### Added
- **2D parallax view:** a ray-marched depth parallax wallpaper (ported from 2.5dwallpp). Settings: focus plane, strength, tilt, lighting, cursor smoothing, auto motion and inverse direction.
- **3D camera view:** a true orbit camera (rotate, pan, zoom, auto-rotate) on displaced meshes, with mesh resolution, depth scale, edge-tear cutoff, wireframe, depth colours and a background toggle.
- **config.json view:** a code editor for all settings, with comments listing every range. Edits apply live, and both nested and flat keys are accepted. Values are clamped and problems are reported by path. Copy, Download and Defaults buttons.
- **Show stage** (Result, 1 · Main object mask, 2 · Object depth, Whole-image depth) and **Pick object…** (click the subject).
- **Wallpaper Preview before export:** frame aspect presets, a clock/date overlay and an export bar.
- **Live HTML wallpaper export:** one self-contained page with no network requests. It follows the mouse, falls back to auto motion when idle, and uses the gyro on phones. Works in Wallpaper Engine, Lively or any browser.
- Presets by image type: Portrait, Product, Landscape, Illustration.
- Gyro input on touch devices.
- PNGs that already have transparency use it as the mask, and the masker is skipped.
- Workflow hint for the first image of a session.

### Changed
- **Settings schema v2:**
  - The `parallax`, `layers`, `mask`, `depth` and `camera3d` sections use 2.5dwallpp's key names, ranges and defaults, so `config.json` files work in both apps.
  - Old projects and `.pw3d.json` v1 files are migrated.
  - Cached analyses from 1.x are discarded.
- **Mask options:** flip-average, zoom-in second pass, confidence normalisation, depth assist, minimum blob size, largest-only, fill holes, invert, grow/shrink, feather and edge cleanup.
- **Depth options:** model input size, percentile clip, smoothing, edge snap, gamma and invert.
- **Layer set:** inpainted background plate and depth, defringed object, object depth rescaled inside the mask, and object centroid.
- The properties editor mirrors 2.5dwallpp's panel (order, labels, readouts). Mask and depth sliders apply on release.
- Workspaces follow the workflow: Layout, 1 · Mask, 2 · Depth, 3D Camera, Config, Export.
- GLB export follows the 2.5dwallpp layout: meshes `background` and `object`, unlit, +Y up, image height 1.
- Default working resolution is now 1600 px. Transparent pixels are flattened onto white.

### Removed
- The v1 camera modes (cursor, orbit, auto, static), shading view modes, the lighting rig, and the geometry and reconstruction panels.

## [1.2.0] - 2026-11-22

### Changed
- New logo (three stacked photo cards) used for the favicon, top bar, splash and About dialog.
- The UI is recoloured from the logo palette: indigo-tinted neutrals, electric-blue selection, hot-pink active states, a lime version label, and a gradient progress bar.
- The splash hero and the procedural demo scene are redrawn in the logo's style.
- Wireframe, mask and grid view colours now match the new palette.
- The README has the logo, badges and a brand palette section.

### Fixed
- With no image loaded, the image strip's empty-state hint no longer overlaps the placeholder tiles.

## [1.1.0] - 2026-11-21

### Added
- Outliner eye toggles now show and hide the Background and Foreground meshes in the viewport.
- The renderer uses the pipeline's full-resolution background depth (subject region filled from its surroundings) for the background mesh, instead of recomputing a coarser one.

## [1.0.1] - 2026-11-21

### Fixed
- The camera now covers the viewport instead of fitting the image inside it. Wide viewports no longer show empty bars beside the wallpaper.

## [1.0.0] - 2026-11-21

### Added
- Client-side pipeline: image loading, U²-NetP / U²-Net segmentation, Depth Anything V2 Small depth estimation, using ONNX Runtime Web (WebGPU or multi-threaded WASM) in Web Workers.
- Model download with progress, cached in Cache Storage. A heuristic depth fallback is used offline.
- Reconstruction worker: mask refinement, depth refinement, push-pull background inpainting, edge-bled foreground layer.
- Three.js renderer:
  - CPU-displaced background and foreground meshes, with a custom lit shader and perspective-compensated rest pose.
  - Cursor, orbit, auto and static camera modes.
  - View modes: render, depth, mask, wireframe and layers.
  - GLB export and PNG render.
- Blender-style interface: menus, workspaces, toolbar, viewport header and gizmo, outliner, properties editor, image editor strip, status bar, splash screen, F3 operator search, Z pie menu, undo/redo.
- IndexedDB projects with cached analysis, and `.pw3d.json` wallpaper config import/export.
- Netlify configuration with cross-origin isolation headers.
