import { useEffect, useState } from 'react';

function matchesNow(query: string): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(query).matches;
}

/**
 * Whether a media query matches, kept up to date. The splitters need it
 * because they have to know which axis they are dividing, which is the one
 * thing the stylesheet's breakpoints cannot tell them. False where
 * `matchMedia` is missing (jsdom), which is the wide layout — what the
 * component tests expect.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mql = globalThis.matchMedia(query);
    const update = (): void => {
      setMatches(mql.matches);
    };
    update();
    mql.addEventListener('change', update);
    return () => {
      mql.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}
