import { useCallback, useEffect, useState } from "react";

export type StoredScheme = "light" | "dark" | null;
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "shraff-color-scheme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredScheme(): StoredScheme {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === "light" || val === "dark" ? val : null;
  } catch {
    return null;
  }
}

function applyMetaColorScheme(stored: StoredScheme): void {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", stored ?? "light dark");
  }
}

/**
 * Accessible two-state color scheme hook following modern-web-guidance:
 * - Defaults to OS preference (`light dark`) with no stored override.
 * - Toggling switches to the opposite of the currently rendered scheme.
 * - If the target matches the OS preference, removes the stored value so the site
 *   reverts to following system changes.
 * - Never deletes stored overrides retroactively when OS preference shifts later.
 */
export function useTheme() {
  const [stored, setStored] = useState<StoredScheme>(() => readStoredScheme());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  const resolvedTheme: ResolvedTheme = stored ?? systemTheme;

  useEffect(() => {
    applyMetaColorScheme(stored);
  }, [stored]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setStored(readStoredScheme());
      }
    };

    mq.addEventListener("change", onMediaChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      mq.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const currentSystem = getSystemTheme();
    const currentRendered: ResolvedTheme = stored ?? currentSystem;
    const target: ResolvedTheme = currentRendered === "dark" ? "light" : "dark";

    if (target === currentSystem) {
      setStored(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable; meta still updates in memory
      }
    } else {
      setStored(target);
      try {
        localStorage.setItem(STORAGE_KEY, target);
      } catch {
        // Storage unavailable
      }
    }
  }, [stored]);

  return {
    storedScheme: stored,
    resolvedTheme,
    toggleTheme,
  };
}
