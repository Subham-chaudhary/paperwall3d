/**
 * Model download + persistent caching (Cache Storage).
 *
 * Works in both window and worker contexts. When Cache Storage is unavailable (insecure context, private
 * mode) the model is simply re-downloaded each session — caching is strictly best-effort.
 */
import type { ModelCacheEntry } from '../core/types';
import { allModelFiles, type ModelFile } from './models';

export const MODEL_CACHE_NAME = 'paperwall3d-models-v1';

/** Anything smaller than this is certainly an error page rather than a model. */
const MIN_MODEL_BYTES = 64 * 1024;

/** `fromCache` is true for the single completion callback of a cache hit. */
/** Thrown when a model could not be fetched from any URL (offline, blocked, HTTP error). */
export class ModelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelDownloadError';
  }
}

export type DownloadProgress = (loadedBytes: number, totalBytes: number, fromCache: boolean) => void;

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/** Looks the file up under any of its URLs. */
async function findCached(cache: Cache | null, file: ModelFile): Promise<Response | null> {
  if (!cache) return null;
  for (const url of file.urls) {
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch {
      /* ignore and keep looking */
    }
  }
  return null;
}

/** Reads a response body into one buffer, reporting progress as chunks arrive. */
async function readBody(res: Response, expectedTotal: number, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<ArrayBuffer> {
  const headerLen = Number(res.headers.get('content-length'));
  const total = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : expectedTotal;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress?.(buf.byteLength, buf.byteLength, false);
    return buf;
  }
  const reader = res.body.getReader();
  // Pre-allocate when the size is trustworthy; otherwise collect chunks.
  const exact = Number.isFinite(headerLen) && headerLen > 0;
  const prealloc = exact ? new Uint8Array(headerLen) : null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException('Download aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (prealloc) {
      if (loaded + value.byteLength > prealloc.byteLength) throw new Error('Response longer than content-length');
      prealloc.set(value, loaded);
    } else {
      chunks.push(value);
    }
    loaded += value.byteLength;
    onProgress?.(loaded, Math.max(total, loaded), false);
  }
  if (prealloc) {
    if (loaded !== prealloc.byteLength) throw new Error(`Incomplete download (${loaded} of ${prealloc.byteLength} bytes)`);
    return prealloc.buffer;
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

/**
 * Returns the model bytes, from Cache Storage if present, otherwise downloaded (trying mirrors in order)
 * and then stored. `onProgress` is called with (loaded, total, fromCache); for a cache hit it fires once, complete.
 */
export async function fetchModel(file: ModelFile, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<ArrayBuffer> {
  const cache = await openCache();
  const cached = await findCached(cache, file);
  if (cached) {
    try {
      const buf = await cached.arrayBuffer();
      if (buf.byteLength >= MIN_MODEL_BYTES) {
        onProgress?.(buf.byteLength, buf.byteLength, true);
        return buf;
      }
    } catch {
      /* corrupt entry: fall through and re-download */
    }
    await Promise.all(file.urls.map((u) => cache?.delete(u).catch(() => false)));
  }

  let lastError: unknown = null;
  for (const url of file.urls) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = await readBody(res, file.sizeBytes, onProgress, signal);
      if (buf.byteLength < MIN_MODEL_BYTES) throw new Error(`Suspiciously small model file (${buf.byteLength} bytes)`);
      if (cache) {
        try {
          await cache.put(
            file.urls[0]!,
            new Response(buf, {
              headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) },
            }),
          );
        } catch {
          /* quota exceeded etc.: caching is best-effort */
        }
      }
      return buf;
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
      lastError = err;
    }
  }
  throw new ModelDownloadError(`Could not download ${file.label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Reports every registry file with its cached state. */
export async function listModels(): Promise<ModelCacheEntry[]> {
  const cache = await openCache();
  const out: ModelCacheEntry[] = [];
  for (const file of allModelFiles()) {
    const hit = await findCached(cache, file);
    let size = file.sizeBytes;
    if (hit) {
      const len = Number(hit.headers.get('content-length'));
      if (Number.isFinite(len) && len > 0) size = len;
    }
    out.push({ id: file.id, label: file.label, url: file.urls[0]!, sizeBytes: size, cached: !!hit });
  }
  return out;
}

/** Deletes every cached model. */
export async function clearModelCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete(MODEL_CACHE_NAME);
  } catch {
    /* nothing to clear */
  }
}
