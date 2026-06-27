"use client";

import { useEffect, useRef, useState } from "react";
import { METRIC_GROUPS, readPrefs, writePrefs, type MetricGroup } from "@/lib/metric-prefs";

function emphasizeMetricTitle(element: HTMLElement) {
  const title = element.querySelector<HTMLElement>(".section-head .eyebrow");
  if (!title) return;
  title.classList.remove("section-title-attention");
  void title.offsetWidth;
  title.classList.add("section-title-attention");
  window.setTimeout(() => title.classList.remove("section-title-attention"), 900);
}

function scrollToMetric(id: MetricGroup, nextPrefs: Record<MetricGroup, boolean>, turningOn: boolean) {
  const index = METRIC_GROUPS.findIndex((g) => g.id === id);
  const ordered = turningOn
    ? [id]
    : [
        ...METRIC_GROUPS.slice(index + 1).map((g) => g.id),
        ...METRIC_GROUPS.slice(0, index).reverse().map((g) => g.id),
      ];
  const target = ordered.find((group) => nextPrefs[group]);

  window.setTimeout(() => {
    const element = target ? document.querySelector<HTMLElement>(`[data-metric-group="${target}"]`) : document.querySelector<HTMLElement>(".page");
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (element && target) window.setTimeout(() => emphasizeMetricTitle(element), turningOn ? 620 : 420);
  }, 60);
}

export function MetricPicker() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Record<MetricGroup, boolean> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setPrefs(readPrefs()), []);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(id: MetricGroup) {
    if (!prefs) return;
    const turningOn = !prefs[id];
    const next = { ...prefs, [id]: turningOn };
    setPrefs(next);
    writePrefs(next);
    scrollToMetric(id, next, turningOn);
  }

  const onCount = prefs ? Object.values(prefs).filter(Boolean).length : 0;

  return (
    <div className="picker" ref={ref}>
      <button type="button" className="pill-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ms">tune</span>Customize<span className="caret ms">expand_more</span>
      </button>
      {open && prefs ? (
        <div className="picker-menu" role="menu">
          <div className="picker-head">Show report sections · {onCount}/{METRIC_GROUPS.length}</div>
          {METRIC_GROUPS.map((g) => (
            <label key={g.id} className="picker-item">
              <input type="checkbox" checked={!!prefs[g.id]} onChange={() => toggle(g.id)} />
              <span>{g.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

