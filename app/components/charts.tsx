"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  BarChart,
  ScatterChart,
  Area,
  Line,
  Bar,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  LabelList,
} from "recharts";
import { compact, intGroup, money } from "@/lib/format";

const M30 = "#0d9488";
const M35 = "#4f46e5";
const BRAND = "#4f46e5";
const TOK_IN = "#4338ca";
const TOK_OUT = "#a8b0f0";
const GRID = "#eceef1";
const AXIS = "#9aa0ac";
const INK = "#181b22";
const INK2 = "#3c4350";
const MONO = "'IBM Plex Mono', monospace";
const CHART_REVEAL_GAP_MS = 130;

let nextChartRevealAt = 0;

function queueChartReveal(callback: () => void) {
  const now = window.performance?.now?.() ?? Date.now();
  const delay = Math.max(0, nextChartRevealAt - now);
  nextChartRevealAt = now + delay + CHART_REVEAL_GAP_MS;
  return window.setTimeout(callback, delay);
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ChartReveal({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || ready) return;
    let timer: number | undefined;
    const reveal = () => {
      if (timer != null) return;
      timer = queueChartReveal(() => setReady(true));
    };

    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight + 320) {
      reveal();
      return () => window.clearTimeout(timer);
    }

    if (!("IntersectionObserver" in window)) {
      reveal();
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        reveal();
        observer.disconnect();
      },
      { root: null, rootMargin: "240px 0px 160px", threshold: 0.01 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [ready]);

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {ready ? children : null}
    </div>
  );
}

function TipCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e7e9ee", borderRadius: 8, boxShadow: "0 10px 24px rgba(16,19,31,.14)", padding: "8px 10px", fontSize: 11.5, fontFamily: "Inter, sans-serif" }}>
      {children}
    </div>
  );
}

function TipRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#565e6c", lineHeight: 1.7 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span>{name}</span>
      <b style={{ marginLeft: "auto", paddingLeft: 14, color: INK, fontFamily: MONO }}>{value}</b>
    </div>
  );
}

/* ---------------- KPI sparkline ---------------- */
export function Sparkline({
  points,
  color,
  fill,
  width = 92,
  height = 40,
}: {
  points: number[];
  color: string;
  fill?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const data = points.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <AreaChart width={width} height={height} data={data} margin={{ top: 3, right: 1, bottom: 2, left: 1 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} fill={fill ? `url(#${id})` : "none"} dot={false} isAnimationActive animationDuration={700} />
    </AreaChart>
  );
}

/* ---------------- Usage over time ---------------- */
function LineTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <TipCard>
      <div style={{ fontWeight: 600, marginBottom: 4, color: INK, fontFamily: MONO }}>{label}</div>
      {payload.map((p: any) => (
        <TipRow key={p.dataKey} color={p.color || p.stroke} name={p.name} value={intGroup(p.value)} />
      ))}
    </TipCard>
  );
}

export function UsageLineChart({
  data,
  backfillFrom,
}: {
  data: Array<{ date: string; prompts: number; tokens: number }>;
  backfillFrom?: string;
}) {
  if (data.length < 2) return <div className="state-sub">Not enough history to plot a trend.</div>;
  const chartData = data.map((d) => ({ date: d.date.slice(5), prompts: d.prompts, blocks: Math.round(d.tokens / 1000) }));
  const bf = backfillFrom ? data.findIndex((d) => d.date >= backfillFrom) : -1;
  const bfStart = bf >= 0 ? chartData[bf].date : undefined;

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span><span className="ln" style={{ background: M35 }} />Prompts / day</span>
        <span><span className="ln" style={{ background: M30 }} />Token blocks / day</span>
        {bfStart ? <span><span className="sw" style={{ background: "#f1d6d2" }} />backfill</span> : null}
      </div>
      <ChartReveal height={210}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id="up-prompts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={M35} stopOpacity={0.22} />
                <stop offset="95%" stopColor={M35} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={26} tick={{ fontSize: 10, fill: AXIS, fontFamily: MONO }} />
            <YAxis tickLine={false} axisLine={false} width={42} tickFormatter={(v) => compact(v)} tick={{ fontSize: 10, fill: AXIS, fontFamily: MONO }} />
            {bfStart ? <ReferenceArea x1={bfStart} x2={chartData[chartData.length - 1].date} fill="#c0473d" fillOpacity={0.06} /> : null}
            <Tooltip cursor={{ stroke: "#c2c7d0", strokeWidth: 1 }} content={<LineTip />} />
            <Area type="monotone" dataKey="prompts" name="Prompts" stroke={M35} strokeWidth={2} fill="url(#up-prompts)" dot={false} activeDot={{ r: 3.5, strokeWidth: 1.5, stroke: "#fff" }} isAnimationActive animationDuration={850} animationEasing="ease-out" />
            <Line type="monotone" dataKey="blocks" name="Token blocks" stroke={M30} strokeWidth={2} dot={false} activeDot={{ r: 3.5, strokeWidth: 1.5, stroke: "#fff" }} isAnimationActive animationBegin={140} animationDuration={850} animationEasing="ease-out" />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartReveal>
    </div>
  );
}

/* ---------------- Relationship scatter ---------------- */
function ScatterTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <TipCard>
      <div style={{ fontWeight: 600, marginBottom: 3, color: INK }}>{p.product}</div>
      <div style={{ color: "#565e6c", fontFamily: MONO }}>{intGroup(p.prompts)} prompts · {p.tokenBlocks} blocks · {money(p.revenue)}</div>
    </TipCard>
  );
}

export function RelationScatter({
  points,
}: {
  points: Array<{ acct: number; model: string; product: string; kind: string; prompts: number; tokenBlocks: number; revenue: number }>;
}) {
  if (points.length === 0) return <div className="state-sub">No usage rows to plot.</div>;
  const d30 = points.filter((p) => p.model !== "3.5");
  const d35 = points.filter((p) => p.model === "3.5");
  const animate = points.length <= 80;
  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span><span className="sw" style={{ background: M30, borderRadius: 9 }} />Odyssey 3.0</span>
        <span><span className="sw" style={{ background: M35, borderRadius: 9 }} />Odyssey 3.5</span>
        <span style={{ color: "var(--faint)" }}>bubble size = billed revenue</span>
      </div>
      <ChartReveal height={300}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" dataKey="tokenBlocks" name="Token blocks" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS, fontFamily: MONO }} tickFormatter={(v) => compact(v)}>
            </XAxis>
            <YAxis type="number" dataKey="prompts" name="Prompts" tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10, fill: AXIS, fontFamily: MONO }} tickFormatter={(v) => compact(v)} />
            <ZAxis type="number" dataKey="revenue" range={[40, 430]} name="Revenue" />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "#c2c7d0" }} content={<ScatterTip />} />
            <Scatter data={d30} fill={M30} fillOpacity={0.6} stroke="#fff" strokeWidth={1} isAnimationActive={animate} animationDuration={520} animationEasing="ease-out" />
            <Scatter data={d35} fill={M35} fillOpacity={0.6} stroke="#fff" strokeWidth={1} isAnimationActive={animate} animationBegin={80} animationDuration={520} animationEasing="ease-out" />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartReveal>
      <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 5 }}>
        x = token blocks · y = prompts per account. Plans bill by prompts <em>or</em> tokens, so accounts sit on one axis.
      </div>
    </div>
  );
}

/* ---------------- Vertical stacked bars ---------------- */
type BarDatum = { label: string; axisLabel?: string; a: number; b?: number; hot?: boolean };

function BarTip({ active, payload, label, unit, aLabel, bLabel }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <TipCard>
      <div style={{ fontWeight: 600, marginBottom: 4, color: INK }}>{label}</div>
      {payload.map((p: any) => (
        <TipRow key={p.dataKey} color={p.color || p.fill} name={p.dataKey === "a" ? aLabel : bLabel} value={intGroup(p.value)} />
      ))}
      <div style={{ borderTop: "1px solid #eceef1", marginTop: 4, paddingTop: 4 }}>
        <TipRow color="transparent" name={`Total ${unit}`} value={intGroup(total)} />
      </div>
    </TipCard>
  );
}

export function VBars({
  data,
  colors,
  unit,
  height = 150,
  labelEvery = 1,
}: {
  data: BarDatum[];
  colors: { a: string; b?: string; aLabel?: string; bLabel?: string };
  unit: string;
  height?: number;
  labelEvery?: number;
}) {
  const stacked = data.some((d) => d.b != null);
  const animate = data.length <= 18;
  return (
    <ChartReveal height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap={data.length > 16 ? "12%" : "22%"}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
          <XAxis dataKey="axisLabel" tickLine={false} axisLine={false} interval={labelEvery - 1} tick={{ fontSize: 9.5, fill: AXIS, fontFamily: MONO }} />
          <YAxis hide />
          <Tooltip cursor={{ fill: "rgba(79,70,229,0.06)" }} content={<BarTip unit={unit} aLabel={colors.aLabel ?? "A"} bLabel={colors.bLabel ?? "B"} />} />
          <Bar dataKey="a" stackId="s" fill={colors.a} radius={stacked ? [0, 0, 0, 0] : [3, 3, 0, 0]} isAnimationActive={animate} animationDuration={560} animationEasing="ease-out">
            {data.map((d, i) => (
              <Cell key={i} fill={colors.a} stroke={d.hot ? BRAND : undefined} strokeWidth={d.hot ? 1.5 : 0} />
            ))}
          </Bar>
          {stacked ? (
            <Bar dataKey="b" stackId="s" fill={colors.b} radius={[3, 3, 0, 0]} isAnimationActive={animate} animationBegin={80} animationDuration={560} animationEasing="ease-out">
              {data.map((d, i) => (
                <Cell key={i} fill={colors.b} stroke={d.hot ? BRAND : undefined} strokeWidth={d.hot ? 1.5 : 0} />
              ))}
            </Bar>
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </ChartReveal>
  );
}

/* ---------------- Horizontal value bars ---------------- */
function HBarTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <TipCard>
      <div style={{ fontWeight: 600, color: INK }}>{p.label}</div>
      <div style={{ color: "#565e6c", fontFamily: MONO, marginTop: 2 }}>{p.valueLabel}{p.sub ? ` · ${p.sub}` : ""}</div>
    </TipCard>
  );
}

export function HBars({
  rows,
  color,
  labelWidth = 148,
  rightPadding = 56,
}: {
  rows: Array<{ label: string; value: number; valueLabel: string; sub?: string; color?: string }>;
  color: string;
  labelWidth?: number;
  rightPadding?: number;
}) {
  const height = rows.length * 34 + 4;
  const animate = rows.length <= 14;
  return (
    <ChartReveal height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={rows} margin={{ top: 0, right: rightPadding, bottom: 0, left: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK2 }} tickFormatter={(v) => truncate(String(v), 24)} />
          <Tooltip cursor={{ fill: "rgba(79,70,229,0.06)" }} content={<HBarTip />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={animate} animationDuration={560} animationEasing="ease-out" maxBarSize={16}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.color ?? color} />
            ))}
            <LabelList dataKey="valueLabel" position="right" style={{ fontSize: 11, fill: INK, fontFamily: MONO, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartReveal>
  );
}

/* ---------------- Horizontal stacked bars (input/output) ---------------- */
function HStackTip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <TipCard>
      <div style={{ fontWeight: 600, color: INK, marginBottom: 3 }}>{p.label}</div>
      <TipRow color={TOK_IN} name="Input" value={`${compact(p.a)} ${unit}`} />
      <TipRow color={TOK_OUT} name="Output" value={`${compact(p.b)} ${unit}`} />
    </TipCard>
  );
}

export function HStackBars({
  rows,
  colors,
  unit,
  labelWidth = 148,
  rightPadding = 56,
}: {
  rows: Array<{ label: string; a: number; b: number }>;
  colors: { a: string; b: string };
  unit: string;
  labelWidth?: number;
  rightPadding?: number;
}) {
  const data = rows.map((r) => ({ ...r, total: r.a + r.b, totalLabel: compact(r.a + r.b) }));
  const height = rows.length * 36 + 4;
  const animate = rows.length <= 12;
  return (
    <ChartReveal height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={data} margin={{ top: 0, right: rightPadding, bottom: 0, left: 0 }} barCategoryGap="26%">
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: INK2 }} tickFormatter={(v) => truncate(String(v), 24)} />
          <Tooltip cursor={{ fill: "rgba(79,70,229,0.06)" }} content={<HStackTip unit={unit} />} />
          <Bar dataKey="a" stackId="t" fill={colors.a} radius={[4, 0, 0, 4]} isAnimationActive={animate} animationDuration={560} animationEasing="ease-out" maxBarSize={18} />
          <Bar dataKey="b" stackId="t" fill={colors.b} radius={[0, 4, 4, 0]} isAnimationActive={animate} animationBegin={80} animationDuration={560} animationEasing="ease-out" maxBarSize={18}>
            <LabelList dataKey="totalLabel" position="right" style={{ fontSize: 11, fill: INK, fontFamily: MONO, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartReveal>
  );
}
