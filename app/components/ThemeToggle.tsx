"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "nextai.theme";

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }

    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
      setMode(stored);
      return;
    }

    const initial = systemPrefersDark() ? "dark" : "light";
    setMode(initial);

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      try {
        const current = window.localStorage.getItem(STORAGE_KEY);
        if (current === "light" || current === "dark") return;
      } catch {
        /* ignore */
      }
      setMode(mql.matches ? "dark" : "light");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const next = mode === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={`Switch to ${next} mode`}
      aria-pressed={mode === "dark"}
      title={`Switch to ${next} mode`}
      onClick={() => {
        applyTheme(next);
        setMode(next);
      }}
    >
      <span className="ms">{mode === "dark" ? "light_mode" : "dark_mode"}</span>
    </button>
  );
}
