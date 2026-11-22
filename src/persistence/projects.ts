/** Saved projects ("Recent Projects") and cached AI analyses, stored in IndexedDB. */
import type { DepthModelId, RawAnalysis, SegmentationModelId, Settings } from '../core/types';
import { idbDelete, idbDeleteByPrefix, idbGet, idbGetAll, idbPut } from './db';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  sourceBlob: Blob;
  thumbnailBlob: Blob | null;
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'updatedAt' | 'thumbnailBlob'>;

export interface AnalysisRecord {
  key: string;
  rawMask: Float32Array;
  rawDepth: Float32Array;
  width: number;
  height: number;
  models: {
    segmentation: SegmentationModelId | null;
    depth: DepthModelId;
    backendUsed: RawAnalysis['backendUsed'];
    workingResolution: number;
  };
}

export function newProjectId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Cache key of an analysis: it is valid as long as the image and AI model choices are unchanged. */
export function analysisKey(projectId: string, settings: Settings): string {
  const m = settings.mask;
  const seg = m.use_subject ? `${m.mask_model}${m.flip_avg ? '+flip' : ''}${m.refine ? '+zoom' : ''}` : 'none';
  return `${projectId}|v2|${settings.runtime.workingResolution}|${seg}|${settings.depth.model}|${settings.depth.depth_size}`;
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  await idbPut('projects', record);
}

export function getProject(id: string): Promise<ProjectRecord | undefined> {
  return idbGet<ProjectRecord>('projects', id);
}

/** Newest first. */
export async function listProjects(limit = 12): Promise<ProjectSummary[]> {
  const all = await idbGetAll<ProjectRecord>('projects');
  return all
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(({ id, name, updatedAt, thumbnailBlob }) => ({ id, name, updatedAt, thumbnailBlob }));
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete('projects', id);
  await idbDeleteByPrefix('analysis', `${id}|`);
}

/** Persist only the settings (and name) of an existing project (autosave). No-op if the project vanished. */
export async function updateProjectSettings(id: string, settings: Settings, name?: string): Promise<void> {
  const rec = await getProject(id);
  if (!rec) return;
  rec.settings = settings;
  if (name) rec.name = name;
  rec.updatedAt = Date.now();
  await saveProject(rec);
}

export async function putAnalysis(projectId: string, settings: Settings, raw: RawAnalysis): Promise<void> {
  const rec: AnalysisRecord = {
    key: analysisKey(projectId, settings),
    rawMask: raw.rawMask,
    rawDepth: raw.rawDepth,
    width: raw.width,
    height: raw.height,
    models: {
      segmentation: raw.segmentationModel,
      depth: raw.depthModel,
      backendUsed: raw.backendUsed,
      workingResolution: settings.runtime.workingResolution,
    },
  };
  await idbPut('analysis', rec);
}

/** Look up a cached analysis and rebuild a RawAnalysis from it. */
export async function getAnalysis(projectId: string, settings: Settings): Promise<RawAnalysis | null> {
  const rec = await idbGet<AnalysisRecord>('analysis', analysisKey(projectId, settings));
  if (!rec) return null;
  return {
    width: rec.width,
    height: rec.height,
    rawMask: rec.rawMask,
    rawDepth: rec.rawDepth,
    segmentationModel: rec.models.segmentation,
    depthModel: rec.models.depth,
    backendUsed: rec.models.backendUsed,
    timings: { cached: 0 },
  };
}
