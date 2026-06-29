"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const WIDTH_KEY = "g6.assistantWidth";
const DEFAULT_WIDTH = 382;
const MIN_WIDTH = 320;

function clampWidth(width: number) {
  if (typeof window === "undefined") return width;
  const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.5));
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(width)));
}

// Collapsible assistant panel. Closed by default; when open it participates in
// the page layout so the dashboard remains visible and usable beside it.
export function AssistantDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragState = useRef<{ pointerId: number } | null>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem("g6.assistantOpen") === "1");
      const storedWidth = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(storedWidth)) setWidth(clampWidth(storedWidth));
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
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  useEffect(() => {
    const onResize = () => setWidth((current) => clampWidth(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function resizeTo(clientX: number) {
    setWidth(clampWidth(window.innerWidth - clientX));
  }

  function onResizeKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (e.key === "Home") setWidth(MIN_WIDTH);
    else if (e.key === "End") setWidth(clampWidth(window.innerWidth * 0.5));
    else setWidth((current) => clampWidth(current + (e.key === "ArrowLeft" ? 24 : -24)));
  }

  if (!open) {
    return (
      <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="Open assistant">
        <span className="ms">smart_toy</span>
        Assistant
      </button>
    );
  }

  const style = { "--assistant-width": `${width}px` } as CSSProperties;

  return (
    <aside className="assistant-drawer open" aria-label="Dashboard assistant" style={style}>
      <div
        className="assistant-resize"
        role="separator"
        aria-label="Resize assistant"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={typeof window === "undefined" ? DEFAULT_WIDTH : Math.floor(window.innerWidth * 0.5)}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize"
        onKeyDown={onResizeKey}
        onPointerDown={(e) => {
          if (window.matchMedia("(max-width: 900px)").matches) return;
          dragState.current = { pointerId: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
          resizeTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!dragState.current || dragState.current.pointerId !== e.pointerId) return;
          resizeTo(e.clientX);
        }}
        onPointerUp={(e) => {
          if (dragState.current?.pointerId === e.pointerId) dragState.current = null;
        }}
        onPointerCancel={() => {
          dragState.current = null;
        }}
      />
      <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close">
        <span className="ms">close</span>
      </button>
      {children}
    </aside>
  );
}
