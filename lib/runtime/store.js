/**
 * dsh-tui runtime store — tiny external store. The agent loop (outside
 * React) pushes normalized events; `onSet` (Ink rerender) drives the UI.
 * React effects are NOT used for subscription: passive effects never ran
 * under this Ink/React combo, so the store notifies the renderer directly.
 *
 * @module dsh-tui-app/runtime/store
 */

export function createStore(initial, onSet) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      onSet?.(state);
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
