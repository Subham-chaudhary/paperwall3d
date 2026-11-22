/** Message shapes between the reconstruct worker and its client. */
import type { ReconstructInputs, ReconstructOutput, ReconstructParams } from './reconstructor';

export type ReconstructRequest =
  | { type: 'setInputs'; id: number; inputs: ReconstructInputs }
  /** Replace only the output-resolution pixels (null = same size as the processing pixels). */
  | { type: 'setHd'; id: number; hd: Uint8ClampedArray | null; width: number; height: number }
  | { type: 'run'; id: number; params: ReconstructParams };

export type ReconstructResponse =
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; output: ReconstructOutput }
  | { type: 'error'; id: number; message: string };
