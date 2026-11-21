/** User preferences (Preferences dialog / output options) persisted in localStorage. */
import { DEFAULT_USER_PREFS, getPref, setPref, type UserPrefs } from '../persistence/prefs';
import { customBinding, type Binding } from './widgets/binding';

class UserPrefsStore {
  private value: UserPrefs = { ...DEFAULT_USER_PREFS, ...getPref<Partial<UserPrefs>>('user', {}) };
  private listeners = new Set<() => void>();

  get<K extends keyof UserPrefs>(key: K): UserPrefs[K] {
    return this.value[key];
  }

  set<K extends keyof UserPrefs>(key: K, v: UserPrefs[K]): void {
    if (this.value[key] === v) return;
    this.value = { ...this.value, [key]: v };
    setPref('user', this.value);
    this.listeners.forEach((l) => l());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  binding<K extends keyof UserPrefs>(key: K): Binding<UserPrefs[K]> {
    return customBinding(
      () => this.get(key),
      (v) => this.set(key, v),
      (fn) => this.subscribe(fn),
    );
  }
}

export const userPrefs = new UserPrefsStore();
