"use client";

import { useEffect, useState } from "react";
import { useNavLoading } from "@/app/components/NavLoading";

const AUTO_MS = 5 * 60 * 1000; // 5 min — analytical/billing dashboards aren't real-time

function ago(fromIso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function RefreshControls({ generatedAt }: { generatedAt: string }) {
  const { refresh, pending } = useNavLoading();
  const [label, setLabel] = useState("just now");

  // "updated Xs ago" ticker
  useEffect(() => {
    const id = setInterval(() => setLabel(ago(generatedAt)), 1000);
    setLabel(ago(generatedAt));
    return () => clearInterval(id);
  }, [generatedAt]);

  // auto-refresh every 5 min, paused while the tab is hidden
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }} title="Auto-refreshes every 5 minutes">
        Updated {label}
      </span>
      <button type="button" className="icon-btn" onClick={refresh} title="Refresh now" aria-label="Refresh data">
        <span className="ms" style={{ animation: pending ? "spin .7s linear infinite" : "none", display: "inline-block" }}>
          refresh
        </span>
      </button>
    </div>
  );
}
