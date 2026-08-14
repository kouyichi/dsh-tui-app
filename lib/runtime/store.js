/**
 * dsh-tui runtime store — tiny external store feeding React via
 * useSyncExternalStore. The agent loop (outside React) pushes normalized
 * events; components subscribe. No framework coupling beyond the hook.
 *
 * @module dsh-tui-app/runtime/store
 */
import { useSyncExternalStore } from "react";

export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** React hook over a store (use with useSyncExternalStore). */
export function useStore(store, select = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
