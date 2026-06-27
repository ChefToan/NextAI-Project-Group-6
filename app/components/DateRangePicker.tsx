"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { presetRange } from "@/lib/range";
import { useNavLoading } from "@/app/components/NavLoading";

export function DateRangePicker({ min, max }: { min: string; max: string }) {
  const { navigate } = useNavLoading();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const from = params.get("from") || "";
  const to = params.get("to") || "";

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function apply(f?: string, t?: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (f) sp.set("from", f);
    else sp.delete("from");
    if (t) sp.set("to", t);
    else sp.delete("to");
    navigate(`${pathname}${sp.toString() ? `?${sp.toString()}` : ""}`);
    setOpen(false);
  }

  const label = from || to ? `${from || "start"} to ${to || "end"}` : "All available data";

  return (
    <div className="picker" ref={ref}>
      <button type="button" className="pill-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ms">calendar_today</span>
        {label}
        <span className="caret ms">expand_more</span>
      </button>
      {open ? (
        <div className="picker-menu" role="menu" style={{ width: 256 }}>
          <div className="picker-head">Billing period</div>
          <button className="picker-row" onClick={() => apply()}>
            All available data
            {min && max ? <span className="picker-row-sub">{min} → {max}</span> : null}
          </button>
          <button
            className="picker-row"
            onClick={() => {
              const r = presetRange("this", min, max);
              apply(r.from, r.to);
            }}
          >
            Latest month in data
          </button>
          <button
            className="picker-row"
            onClick={() => {
              const r = presetRange("last", min, max);
              apply(r.from, r.to);
            }}
          >
            Previous month in data
          </button>
          <div className="picker-sep" />
          <div className="picker-custom">
            <div className="picker-hint">Custom range</div>
            <label>
              From
              <input type="date" defaultValue={from || min} id="dp-from" />
            </label>
            <label>
              To
              <input type="date" defaultValue={to || max} id="dp-to" />
            </label>
            <button
              className="btn"
              style={{ height: 30, width: "100%", justifyContent: "center", marginTop: 6 }}
              onClick={() => {
                const f = (document.getElementById("dp-from") as HTMLInputElement)?.value;
                const t = (document.getElementById("dp-to") as HTMLInputElement)?.value;
                apply(f, t);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
