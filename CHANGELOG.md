# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
