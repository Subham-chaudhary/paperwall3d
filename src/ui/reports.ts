/** Blender-style reports: short info/warning/error messages shown in the status bar. */
import { Emitter } from '../core/events';

export type ReportLevel = 'info' | 'success' | 'warning' | 'error';

export interface Report {
  level: ReportLevel;
  text: string;
  time: number;
}

interface ReportEvents extends Record<string, unknown> {
  report: Report;
}

export class Reports extends Emitter<ReportEvents> {
  readonly history: Report[] = [];

  private push(level: ReportLevel, text: string): void {
    const r: Report = { level, text, time: Date.now() };
    this.history.push(r);
    if (this.history.length > 100) this.history.shift();
    this.emit('report', r);
  }

  info(text: string): void {
    this.push('info', text);
  }

  success(text: string): void {
    this.push('success', text);
  }

  warn(text: string): void {
    console.warn(text);
    this.push('warning', text);
  }

  error(text: string, cause?: unknown): void {
    console.error(text, cause ?? '');
    this.push('error', text);
  }
}

/** Human-readable message from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}
