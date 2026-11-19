/** Message shapes between the reconstruct worker and its client. */
import type { ReconstructInputs, ReconstructOutput, ReconstructParams } from './reconstructor';

export type ReconstructRequest =
  | { type: 'setInputs'; id: number; inputs: ReconstructInputs }
  | { type: 'run'; id: number; params: ReconstructParams };

export type ReconstructResponse =
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; output: ReconstructOutput }
  | { type: 'error'; id: number; message: string };
