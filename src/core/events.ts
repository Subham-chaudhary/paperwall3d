/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    const s = set;
    s.add(fn as (payload: never) => void);
    return () => {
      s.delete(fn as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.map.get(type)?.forEach((fn) => (fn as (p: Events[K]) => void)(payload));
  }

  clear(): void {
    this.map.clear();
  }
}
