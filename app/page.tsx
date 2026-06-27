import { getGroup6Dashboard } from "@/lib/brm-group6";
import { getGroup6Usage } from "@/lib/group6-usage";
import { parseRange } from "@/lib/range";
import { compact, intGroup, money0, money } from "@/lib/format";
import { shortProduct, modelOf, modelTagClass } from "@/lib/labels";
import { Shell } from "@/app/components/Shell";
import { KpiCard } from "@/app/components/kpi";
import { HStackBars, HBars, UsageLineChart } from "@/app/components/charts";
import { Group6Assistant } from "@/app/group6-assistant";
import { DateRangePicker } from "@/app/components/DateRangePicker";
import { RefreshControls } from "@/app/components/RefreshControls";
import { SummarizeButton } from "@/app/components/SummarizeButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.from ?? null, sp.to ?? null);
  const [dash, usage] = await Promise.all([getGroup6Dashboard(), getGroup6Usage(range)]);

  const updated = `${new Date(usage.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  const windowLabel = usage.windowUtc.min
    ? `${usage.windowUtc.min.slice(0, 10)} → ${usage.windowUtc.max.slice(0, 10)} · ${usage.windowUtc.days} days`
    : "no usage in range";

  const toolbar = (
    <>
      <span className="chip" style={{ cursor: "default" }}>
        <span className="ms">groups</span>Group 6 · {usage.kpis.totalUsers} customers
      </span>
      <DateRangePicker min={usage.availableRange.min} max={usage.availableRange.max} />
      <RefreshControls generatedAt={usage.generatedAt} />
      <div className="legend" style={{ marginLeft: 4 }}>
        <span><span className="sw" style={{ background: "var(--m30)" }} />Odyssey 3.0</span>
        <span><span className="sw" style={{ background: "var(--m35)" }} />Odyssey 3.5</span>
      </div>
    </>
  );

  if (!usage.connected) {
    return (
      <Shell active="overview" title="Overview" crumb="Overview" updatedText="Not connected" windowLabel="—" toolbar={toolbar} assistant={<Group6Assistant data={dash} />}>
        <DisconnectedState />
      </Shell>
    );
  }

  const k = usage.kpis;
  const dv = usage.derived;
  const m30 = usage.models.find((m) => m.model === "3.0");
  const m35 = usage.models.find((m) => m.model === "3.5");

  const dailyPrompts = usage.daily.map((d) => d.prompts);
  const dailyBlocks = usage.daily.map((d) => d.tokens / 1000);
  const dailyRev = usage.daily.map((d) => d.revenue);

  const tokenRows = usage.tokenByProduct.map((t) => ({ label: shortProduct(t.product), a: t.inputTokens / 1000, b: t.outputTokens / 1000 }));
  const mixRows = usage.productMix.map((m) => ({
    label: shortProduct(m.product), value: m.revenueDue, valueLabel: money(m.revenueDue),
    sub: `${m.users} customers · ${m.kind}`, color: m.model === "3.5" ? "var(--m35)" : "var(--m30)",
  }));
  const planRows = usage.usersByPlan.map((p) => ({
    label: shortProduct(p.plan), value: p.users, valueLabel: `${p.users}`,
    sub: money(p.revenueDue), color: p.model === "3.5" ? "var(--m35)" : "var(--m30)",
  }));

  return (
    <Shell active="overview" title="Overview" crumb="Overview" updatedText={`Updated ${updated}`} windowLabel={windowLabel} toolbar={toolbar} assistant={<Group6Assistant data={dash} />}>
      {/* KPI strip */}
      <div className="section-head first">
        <h2 className="eyebrow">Health</h2>
        <span className="section-sub">6 metrics · {usage.windowUtc.days}-day window</span>
      </div>
      <div className="kpi-grid mb-24">
        <KpiCard primary label="Revenue due" value={money0(k.revenueDue)} mark="Billed" chip={`${intGroup(k.billCount)} bills`} chipTone="neutral"
          foot={<span>Total due from <b>BILL_T</b> across Group 6</span>}
          spark={{ points: dailyRev, color: "var(--brand)", fill: "var(--brand-soft)" }} />
        <KpiCard label="Tokens used" value={compact(k.totalTokens)} chip={`${k.inputSharePct}% input`} chipTone="neutral"
          foot={<span>in <b>{compact(k.inputTokens)}</b> · out <b>{compact(k.outputTokens)}</b></span>}
          spark={{ points: dailyBlocks, color: "var(--m30)", fill: "var(--m30-soft)" }} />
        <KpiCard label="Prompts billed" value={intGroup(k.totalPrompts)} chip="PromptG6 RUM" chipTone="neutral"
          foot={<span>of <b>{intGroup(k.usageEvents)}</b> usage events</span>}
          spark={{ points: dailyPrompts, color: "var(--m35)", fill: "var(--m35-soft)" }} />
        <KpiCard label="Active customers" value={intGroup(k.activeUsers)} dot="var(--good)" chip={`${k.activePct}% active`} chipTone="good"
          foot={<span>of <b>{k.totalUsers}</b> Group 6 customers</span>} />
        <KpiCard label="Avg revenue / customer" value={money(k.avgRevenuePerUser)} chip="per customer" chipTone="neutral"
          foot={<span>revenue due / {k.totalUsers} customers</span>} />
        <KpiCard label="Usage events" value={intGroup(k.usageEvents)} chip={`${dv.modelCount} models`} chipTone="neutral"
          foot={<span className="kpi-model-split"><span>Odyssey 3.0 <b>{intGroup(m30?.events ?? 0)}</b></span><span>Odyssey 3.5 <b>{intGroup(m35?.events ?? 0)}</b></span></span>} />
      </div>

      {/* usage over time */}
      <section className="metric-section-anchor">
        <div className="section-head">
          <h2 className="eyebrow">Activity</h2>
          <span className="section-sub">how usage moved over the period</span>
        </div>
        <div className="panel mb-24">
          <div className="panel-head">
            <div>
              <div className="panel-title">Usage volume over time</div>
              <div className="panel-sub">prompts &amp; token blocks per day · by event start time</div>
            </div>
          </div>
          <UsageLineChart data={usage.daily} backfillFrom={dv.backfillDays[0]} />
          <SummarizeButton panel="Usage volume over time" context={{ window: usage.windowUtc, daily: usage.daily, peakHours: dv.peakHours, medianDailyPrompts: dv.medianDailyPrompts, backfillDays: dv.backfillDays }} />
        </div>
      </section>

      {/* composition */}
      <section className="metric-section-anchor">
        <div className="section-head">
          <h2 className="eyebrow">Composition</h2>
          <span className="section-sub">what we are billing for</span>
        </div>
        <div className="grid-2 mb-24">
          <div className="panel">
            <div className="panel-head">
              <div><div className="panel-title">Token breakdown by product</div><div className="panel-sub">input vs output blocks · token-billed plans</div></div>
              <div className="legend"><span><span className="sw" style={{ background: "var(--tok-in)" }} />Input</span><span><span className="sw" style={{ background: "var(--tok-out)" }} />Output</span></div>
            </div>
            <HStackBars rows={tokenRows} colors={{ a: "var(--tok-in)", b: "var(--tok-out)" }} unit="blocks" />
            <SummarizeButton panel="Token breakdown by product" context={{ tokenByProduct: usage.tokenByProduct, inputSharePct: k.inputSharePct }} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <div><div className="panel-title">Product mix by revenue</div><div className="panel-sub">billed due · {usage.productMix.length} products</div></div>
            </div>
            <HBars rows={mixRows} color="var(--brand)" />
          </div>
        </div>
      </section>

      {/* customers & plans */}
      <section className="metric-section-anchor">
        <div className="section-head">
          <h2 className="eyebrow">Customers</h2>
          <span className="section-sub">current plan distribution</span>
        </div>
        <div className="panel mb-24">
          <div className="panel-head">
            <div><div className="panel-title">Customers per plan</div><div className="panel-sub">{usage.usersByPlan.length} plans</div></div>
          </div>
          <HBars rows={planRows} color="var(--brand)" />
          <SummarizeButton panel="Customers per plan" context={{ usersByPlan: usage.usersByPlan }} />
        </div>

        <div className="section-head">
          <h2 className="eyebrow">Accounts</h2>
          <span className="section-sub">recently created accounts</span>
        </div>
        <div className="tbl-wrap">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Account</th><th scope="col">Product</th><th scope="col">Model</th><th scope="col">Status</th><th scope="col">Created (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {dash.users.map((u) => {
                  const model = modelOf(u.productName);
                  return (
                    <tr key={u.accountId}>
                      <th scope="row" className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>#{u.accountId}</th>
                      <td>{shortProduct(u.productName)}</td>
                      <td><span className={modelTagClass(model)}>Odyssey {model}</span></td>
                      <td><span className={`tag ${u.accountStatusLabel === "Active" ? "tag-good" : "tag-muted"}`}>{u.accountStatusLabel}</span></td>
                      <td className="mono" style={{ color: "var(--muted)" }}>{u.accountCreatedAtUtc}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </Shell>
  );
}

function DisconnectedState() {
  return (
    <div className="panel">
      <div className="state-box">
        <span className="ms">cloud_off</span>
        <div className="state-title">Oracle BRM is not reachable</div>
        <div className="state-sub">
          The SSH tunnel to the OCI server may be down. Start it with <span className="mono">npm run db:tunnel</span>, confirm <span className="mono">/api/db/health</span>, then refresh. Your data is safe — nothing was written.
        </div>
      </div>
    </div>
  );
}



