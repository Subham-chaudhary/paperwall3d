/** Capability detection shared by the main thread and workers. */
import type { BackendInfo } from '../core/types';

interface GpuNavigator {
  gpu?: { requestAdapter(): Promise<object | null> };
}

/** True when a WebGPU adapter can actually be obtained (not merely when the API exists). */
export async function detectWebGpu(): Promise<boolean> {
  try {
    const gpu = (globalThis.navigator as unknown as GpuNavigator | undefined)?.gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/** Multi-threaded WASM needs SharedArrayBuffer, i.e. cross-origin isolation. */
export function canUseWasmThreads(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export function hardwareThreads(): number {
  return globalThis.navigator?.hardwareConcurrency || 1;
}

/** Thread count handed to ONNX Runtime's WASM backend. */
export function wasmThreadCount(): number {
  return canUseWasmThreads() ? Math.max(1, Math.min(4, hardwareThreads())) : 1;
}

export async function probeBackend(active: BackendInfo['active']): Promise<BackendInfo> {
  return {
    webgpu: await detectWebGpu(),
    wasmThreads: canUseWasmThreads(),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    hardwareConcurrency: hardwareThreads(),
    active,
  };
}
