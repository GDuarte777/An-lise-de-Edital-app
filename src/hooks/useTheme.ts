import { useState, useEffect } from "react";

export type ThemeMode = "light" | "dark" | "system";

// Shared global state for theme to synchronize multiple instances of useTheme hook
let globalTheme: ThemeMode = (() => {
  try {
    const stored = localStorage.getItem("theme") as ThemeMode;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch (e) {
    console.warn("localStorage is not available:", e);
  }
  return "system";
})();

const listeners = new Set<(theme: ThemeMode) => void>();

function setGlobalTheme(newTheme: ThemeMode) {
  globalTheme = newTheme;
  try {
    localStorage.setItem("theme", newTheme);
  } catch (e) {
    console.warn("Could not save theme to localStorage:", e);
  }
  listeners.forEach((listener) => listener(newTheme));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(globalTheme);

  useEffect(() => {
    const handleThemeChange = (newTheme: ThemeMode) => {
      setThemeState(newTheme);
    };
    listeners.add(handleThemeChange);
    // Sync initial in case it changed elsewhere since mount
    setThemeState(globalTheme);
    return () => {
      listeners.delete(handleThemeChange);
    };
  }, []);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (globalTheme === "system") {
      if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      return "dark";
    }
    return globalTheme === "light" ? "light" : "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    
    // Helper to apply classes
    const applyTheme = (activeTheme: "light" | "dark") => {
      setResolvedTheme(activeTheme);
      if (activeTheme === "light") {
        root.classList.add("light");
      } else {
        root.classList.remove("light");
      }
    };

    // If theme is specifically set
    if (theme !== "system") {
      applyTheme(theme);
      return;
    }

    // If theme is system, handle OS media query
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const handleSystemChange = (e: MediaQueryListEvent | MediaQueryList) => {
      applyTheme(e.matches ? "dark" : "light");
    };

    // Initial check
    handleSystemChange(mediaQuery);

    // Event listener for OS changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleSystemChange);
      return () => mediaQuery.removeEventListener("change", handleSystemChange);
    } else {
      // Legacy compatibility
      mediaQuery.addListener(handleSystemChange);
      return () => mediaQuery.removeListener(handleSystemChange);
    }
  }, [theme]);

  return {
    theme,
    setTheme: setGlobalTheme,
    resolvedTheme,
  };
}
