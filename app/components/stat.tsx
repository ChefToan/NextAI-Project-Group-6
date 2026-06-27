import type { ReactNode } from "react";

// Compact metric tile for secondary metrics (status, exceptions, tax, AR).
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  dot,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "brand";
  dot?: boolean;
}) {
  const color =
    tone === "good" ? "var(--good-ink)" : tone === "warn" ? "var(--warn-ink)" : tone === "bad" ? "var(--bad-ink)" : tone === "brand" ? "var(--brand-ink)" : "var(--ink)";
  const dotColor =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : tone === "brand" ? "var(--brand)" : "var(--gray)";
  return (
    <div className="stat-tile">
      <div className="stat-label">
        {dot ? <span className="kpi-dot" style={{ background: dotColor, width: 7, height: 7 }} /> : null}
        {label}
      </div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function StatGrid({ children, min = 150 }: { children: ReactNode; min?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 }}>
      {children}
    </div>
  );
}
