/**
 * AI + image-processing pipeline entry point.
 *
 * Usage:
 *   const pipeline = createPipeline();
 *   const source = await pipeline.loadImage(file, file.name, settings.runtime.workingResolution);
 *   const raw = await pipeline.analyze(source, settings);       // slow; cached per component
 *   const scene = await pipeline.reconstruct(source, raw, settings); // fast; safe on every slider change
 *
 * Cancellation: pipeline.cancel() (or starting a newer analyze()) makes the in-flight analyze() reject
 * with a DOMException named "AbortError".
 */
import type { IPipeline } from '../core/types';
import { Pipeline } from './pipeline';

export function createPipeline(): IPipeline {
  return new Pipeline();
}

export type { PreparedSceneEx } from './reconstructClient';
