import type { ReactNode } from "react";
import { Sparkline } from "@/app/components/charts";

export function KpiCard({
  label,
  value,
  unit,
  chip,
  chipTone = "neutral",
  foot,
  dot,
  primary,
  mark,
  spark,
}: {
  label: string;
  value: string;
  unit?: string;
  chip?: string;
  chipTone?: "good" | "bad" | "warn" | "neutral";
  foot?: ReactNode;
  dot?: string;
  primary?: boolean;
  mark?: string;
  spark?: { points: number[]; color: string; fill?: string };
}) {
  return (
    <div className={`kpi${primary ? " primary" : ""}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {mark ? <span className="kpi-mark">{mark}</span> : dot ? <span className="kpi-dot" style={{ background: dot }} /> : null}
      </div>
      <div className="kpi-mid">
        <div>
          <div className="kpi-value">
            {value}
            {unit ? <span className="unit"> {unit}</span> : null}
          </div>
          {chip ? <span className={`kpi-delta d-${chipTone}`}>{chip}</span> : null}
        </div>
        {spark ? <Sparkline points={spark.points} color={spark.color} fill={spark.fill} /> : null}
      </div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}
