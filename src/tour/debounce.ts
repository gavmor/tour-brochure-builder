/**
 * A debounce with `flush`/`cancel`/`pending`, used by the URL writer in
 * `store.ts` so a burst of keystrokes costs one `history.replaceState` instead
 * of one per character.
 *
 * This used to live in `persistence.ts` alongside the localStorage autosave.
 * That file is gone — the URL hash is the only place tour state lives now
 * (see `docs/adr/0002-url-sole-source-of-truth.md`) — but the timing helper
 * outlived it.
 */

/** How long the URL writer coalesces mutations before writing the hash. */
export const URL_SYNC_DELAY_MS = 300;

export interface Debounced<T extends unknown[]> {
  (...args: T): void;
  /** Run a pending call right now. */
  flush(): void;
  /** Drop a pending call. */
  cancel(): void;
  /** True while a call is scheduled. */
  readonly pending: boolean;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay = URL_SYNC_DELAY_MS,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const run = () => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: T) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  }) as Debounced<T> & { pending: boolean };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  Object.defineProperty(debounced, "pending", { get: () => timer !== null });
  return debounced;
}
