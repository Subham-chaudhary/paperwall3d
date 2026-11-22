/**
 * Dedicated worker for the cheap post-processing stage, so slider drags never block the UI thread and
 * never queue behind a long neural-network run in the inference worker.
 */
import type { ReconstructRequest, ReconstructResponse } from './reconstruct.protocol';
import { Reconstructor } from './reconstructor';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const reconstructor = new Reconstructor();

function reply(msg: ReconstructResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = (ev: MessageEvent<ReconstructRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'setInputs') {
      reconstructor.setInputs(req.inputs);
      reply({ type: 'ready', id: req.id });
    } else if (req.type === 'setHd') {
      reconstructor.setHd(req.hd, req.width, req.height);
      reply({ type: 'ready', id: req.id });
    } else {
      const output = reconstructor.run(req.params);
      const transfer: Transferable[] = [
        output.mask.buffer,
        output.depth.buffer,
        output.bgDepth.buffer,
        output.fgDepth.buffer,
        output.objDepth.buffer,
      ];
      // The (large) colour layers are only present when they changed.
      if (output.bgColor) transfer.push(output.bgColor.buffer);
      if (output.fg) transfer.push(output.fg.buffer);
      reply({ type: 'result', id: req.id, output }, transfer);
    }
  } catch (err) {
    reply({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
