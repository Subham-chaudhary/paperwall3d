# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
