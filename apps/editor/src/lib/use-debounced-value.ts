/**
 * useDebouncedValue — return `value` after `delay` ms of quiescence.
 *
 * Used by `<PreviewStrip>` to throttle the doc reference passed into
 * thumbnails so the strip doesn't thrash on every keystroke. The
 * right-panel preview itself still gets the live doc.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
