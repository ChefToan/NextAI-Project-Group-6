"use client";

import { useEffect, useState, type ReactNode } from "react";

// Collapsible assistant panel. Closed by default; when open it participates in
// the page layout so the dashboard remains visible and usable beside it.
export function AssistantDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem("g6.assistantOpen") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("g6.assistantOpen", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="Open assistant">
        <span className="ms">smart_toy</span>
        Assistant
      </button>
    );
  }

  return (
    <aside className="assistant-drawer open" aria-label="Dashboard assistant">
      <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close">
        <span className="ms">close</span>
      </button>
      {children}
    </aside>
  );
}
