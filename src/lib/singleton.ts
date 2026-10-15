/**
 * Process-wide singletons that survive Next.js bundling each route separately (and dev hot reloads).
 * Without this, every route handler can end up with its own scheduler, cache, metrics and mock
 * Business Central, which silently breaks global limits and cross-route state.
 */
const g = globalThis as unknown as { __wmsSingletons?: Record<string, unknown> };

export function singleton<T>(key: string, make: () => T): T {
  const store = (g.__wmsSingletons ??= {});
  if (!(key in store)) store[key] = make();
  return store[key] as T;
}

export function resetSingleton(key: string): void {
  if (g.__wmsSingletons) delete g.__wmsSingletons[key];
}
