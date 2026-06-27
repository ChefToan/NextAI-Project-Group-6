"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { readPrefs, isDefaultOn, PREFS_EVENT, type MetricGroup } from "@/lib/metric-prefs";

// Wraps a server-rendered section and hides it when its metric group is toggled
// off in the MetricPicker. Initial state = the group default to avoid SSR flash.
// When the user switches a section ON, a short shimmer skeleton is shown first so
// the appearing content reads as "loading" rather than popping in abruptly (and it
// gives Recharts a beat to measure its container before the first paint).
export function MetricSection({ group, children }: { group: MetricGroup; children: ReactNode }) {
  const [on, setOn] = useState(() => isDefaultOn(group));
  const [loading, setLoading] = useState(false);
  const onRef = useRef(on);
  const mounted = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const sync = () => {
      const next = readPrefs()[group];
      const prev = onRef.current;
      onRef.current = next;
      setOn(next);
      if (next && !prev && mounted.current) {
        setLoading(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setLoading(false), 380);
      }
    };
    sync();
    mounted.current = true;
    window.addEventListener(PREFS_EVENT, sync);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      window.clearTimeout(timer.current);
    };
  }, [group]);

  if (!on) return null;
  return (
    <section data-metric-group={group} className="metric-section-anchor section-reveal">
      {loading ? <SectionSkeleton /> : children}
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="mb-24" aria-busy="true" aria-label="Loading section">
      <div className="section-head">
        <span className="skeleton" style={{ height: 13, width: 150, display: "block" }} />
      </div>
      <div className="panel">
        <span className="skeleton" style={{ height: 11, width: "32%", display: "block", marginBottom: 16 }} />
        <span className="skeleton" style={{ height: 190, width: "100%", display: "block", borderRadius: 8 }} />
      </div>
    </div>
  );
}
