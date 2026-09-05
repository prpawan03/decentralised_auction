import { useCallback, useSyncExternalStore } from "react";

/**
 * Theme state lives on <html>, not in React.
 *
 * The class is applied by an inline script in index.html before first paint,
 * so there is no flash. Mirroring it into useState would make React the second
 * source of truth for something the DOM already knows, which is exactly the
 * `useState(propValue)` bug in a different coat. `useSyncExternalStore` reads
 * the DOM instead.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "auction:theme";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("theme-light") ? "light" : "dark";
}

/* jsdom and SSR both land here. Dark is the documented default. */
function getServerSnapshot(): Theme {
  return "dark";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("theme-light", next === "light");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Storage blocked. The choice still applies for this page view. */
    }
    emit();
  }, []);

  const toggle = useCallback(() => {
    setTheme(getSnapshot() === "light" ? "dark" : "light");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
