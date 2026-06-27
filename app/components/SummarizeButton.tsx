"use client";

import { useState } from "react";

// On-demand one-line AI summary for a single chart panel. Renders only after
// the user asks, then keeps the control stable while showing the answer inline.
export function SummarizeButton({ panel, context }: { panel: string; context: unknown }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; source: "ai" | "computed" } | null>(null);
  const [error, setError] = useState(false);

  async function run() {
    if (loading || result) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/group6/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panel, context }),
      });
      const json = (await res.json()) as { text?: string; source?: "ai" | "computed" };
      if (json.text) setResult({ text: json.text, source: json.source === "ai" ? "ai" : "computed" });
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const done = Boolean(result);

  return (
    <div className="summary-row" aria-live="polite">
      <button
        type="button"
        className={`summarize-btn${done ? " is-done" : ""}`}
        onClick={run}
        disabled={loading || done}
        aria-disabled={loading || done}
      >
        <span className="ms summary-icon" style={{ animation: loading ? "spin .8s linear infinite" : "none" }}>
          {loading ? "progress_activity" : done ? "summarize" : "auto_awesome"}
        </span>
        {loading ? "Summarizing..." : done ? "Summary" : "Summarize"}
      </button>
      {result ? <span key={result.text} className="summary-text">{result.text}</span> : null}
      {error ? <span className="summary-error">Couldn&apos;t summarize. Try again.</span> : null}
    </div>
  );
}
