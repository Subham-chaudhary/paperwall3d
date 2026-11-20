/**
 * Public surface of the 3D renderer workstream.
 * Implementation lives in renderer.ts (IRenderer) and demoScene.ts (placeholder scene).
 */
import type { IRenderer } from '../core/types';
import { PaperRenderer } from './renderer';

export { createDemoScene } from './demoScene';

/** Create a renderer whose canvas is appended to (and sized by) `container`. */
export function createRenderer(container: HTMLElement): IRenderer {
  return new PaperRenderer(container);
}
