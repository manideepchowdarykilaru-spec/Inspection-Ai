import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@/services/storage';

/**
 * Subscribes a component to the mock data layer.
 *
 * `selector` is re-run whenever any service mutates the database, which keeps
 * tables, counters and charts in sync without a global state library.
 */
export function useDatabase<T>(selector: () => T, deps: unknown[] = []): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoSelector = useCallback(selector, deps);
  const [value, setValue] = useState<T>(memoSelector);

  useEffect(() => {
    setValue(memoSelector());
    const unsubscribe = subscribe(() => setValue(memoSelector()));
    return () => {
      unsubscribe();
    };
  }, [memoSelector]);

  return value;
}
