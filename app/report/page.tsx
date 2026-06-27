import { getGroup6Dashboard } from "@/lib/brm-group6";
import { getGroup6Usage, formatHours, formatHourRanges } from "@/lib/group6-usage";
import { parseRange } from "@/lib/range";
import { intGroup, money, pct } from "@/lib/format";
import { shortProduct } from "@/lib/labels";
import { Shell } from "@/app/components/Shell";
import { VBars, HStackBars, HBars, RelationScatter } from "@/app/components/charts";
import { ExportCsvButton } from "@/app/components/export";
import { Group6Assistant } from "@/app/group6-assistant";
import { DateRangePicker } from "@/app/components/DateRangePicker";
import { RefreshControls } from "@/app/components/RefreshControls";
import { MetricPicker } from "@/app/components/MetricPicker";
import { MetricSection } from "@/app/components/MetricSection";
import { SummarizeButton } from "@/app/components/SummarizeButton";
import { StatTile, StatGrid } from "@/app/components/stat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.from ?? null, sp.to ?? null);
  const [dash, usage] = await Promise.all([getGroup6Dashboard(), getGroup6Usage(range)]);

  const windowLabel = usage.windowUtc.min
    ? `${usage.windowUtc.min.slice(0, 10)} → ${usage.windowUtc.max.slice(0, 10)} · ${usage.windowUtc.days} days`
    : "no usage in range";

  const csvRows: (string | number)[][] = [
    ["date", "prompts", "tokens", "usage_revenue_usd"],
    ...usage.daily.map((d) => [d.date, d.prompts, d.tokens, d.revenue]),
  ];

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
      <div className="toolbar-spacer" />
      <MetricPicker />
      <ExportCsvButton rows={csvRows} filename="group6-daily-usage.csv" label="Export daily CSV" />
    </>
  );

  if (!usage.connected) {
    return (
      <Shell active="report" title="Statistics & Report" crumb="Statistics & Report" updatedText="Not connected" windowLabel="—" toolbar={toolbar} assistant={<Group6Assistant data={dash} />}>
        <div className="panel"><div className="state-box"><span className="ms">cloud_off</span><div className="state-title">Oracle BRM is not reachable</div><div className="state-sub">Start the SSH tunnel and refresh.</div></div></div>
      </Shell>
    );
  }

  const hourBars = usage.byHour.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, axisLabel: String(h.hour).padStart(2, "0"), a: h.m30, b: h.m35, hot: usage.peakHours.includes(h.hour) }));
  const dowBars = usage.byDow.map((d) => ({ label: d.label, axisLabel: d.label, a: d.total }));
  const weekBars = usage.byWeek.map((w) => ({ label: w.label, axisLabel: w.label, a: w.total }));
  const tierBars = usage.tiers.map((t) => ({ label: `Usage L${t.tier}`, axisLabel: `L${t.tier}`, a: t.m30, b: t.m35 }));
  const backfillNote = usage.derived.backfillDays.length ? `events · skewed by a ${usage.derived.backfillDays.length}-day backfill` : "events";

  const md30 = usage.models.find((m) => m.model === "3.0");
  const md35 = usage.models.find((m) => m.model === "3.5");
  const cell = (m: typeof md30, fn: (x: NonNullable<typeof md30>) => string) => (m ? fn(m) : "—");
  const modelRows = [
    { metric: "Customers", v30: cell(md30, (m) => intGroup(m.users)), v35: cell(md35, (m) => intGroup(m.users)) },
    { metric: "Usage events", v30: cell(md30, (m) => intGroup(m.events)), v35: cell(md35, (m) => intGroup(m.events)) },
    { metric: "Prompts billed", v30: cell(md30, (m) => intGroup(m.prompts)), v35: cell(md35, (m) => intGroup(m.prompts)) },
    { metric: "Token blocks", v30: cell(md30, (m) => intGroup(m.tokenBlocks)), v35: cell(md35, (m) => intGroup(m.tokenBlocks)) },
    { metric: "Usage revenue (PAYG)", v30: cell(md30, (m) => money(m.usageRevenue)), v35: cell(md35, (m) => money(m.usageRevenue)) },
    { metric: "Billed revenue", v30: cell(md30, (m) => money(m.revenueDue)), v35: cell(md35, (m) => money(m.revenueDue)) },
  ];

  const tokByModel = usage.models.map((m) => ({ label: `Odyssey ${m.model}`, a: m.inputTokens / 1000, b: m.outputTokens / 1000 }));
  const tokByProductRows = usage.tokenByProduct.map((t) => ({ label: shortProduct(t.product), a: t.inputTokens / 1000, b: t.outputTokens / 1000 }));
  const customerProductRows = usage.productMix.map((m) => ({ label: shortProduct(m.product), value: m.users, valueLabel: `${m.users}`, sub: m.kind, color: m.model === "3.5" ? "var(--m35)" : "var(--m30)" }));
  const customerPlanRows = usage.usersByPlan.map((p) => ({ label: shortProduct(p.plan), value: p.users, valueLabel: `${p.users}`, sub: money(p.revenueDue), color: p.model === "3.5" ? "var(--m35)" : "var(--m30)" }));
  const stateRows = usage.tax.byState.map((x) => ({ label: x.state, value: x.revenueDue, valueLabel: money(x.revenueDue), sub: `${x.accounts} accts` }));

  const tax = usage.tax;
  const ar = usage.ar;
  const ex = usage.exceptions;
  const st = usage.statusBreakdown;

  return (
    <Shell active="report" title="Statistics & Report" crumb="Statistics & Report" updatedText={`Updated ${new Date(usage.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`} windowLabel={windowLabel} toolbar={toolbar} assistant={<Group6Assistant data={dash} />}>
      {/* models */}
      <div className="section-head first"><h2 className="eyebrow">Models</h2><span className="section-sub">Odyssey 3.0 vs 3.5</span></div>
      <div className="tbl-wrap mb-24">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead><tr><th scope="col">Metric</th><th scope="col" className="num">Odyssey 3.0</th><th scope="col" className="num">Odyssey 3.5</th></tr></thead>
            <tbody>
              {modelRows.map((r) => (
                <tr key={r.metric}><th scope="row">{r.metric}</th><td className="num">{r.v30}</td><td className="num">{r.v35}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* token breakdown */}
      <MetricSection group="tokenBreakdown">
        <div className="section-head"><h2 className="eyebrow">Token breakdown</h2><span className="section-sub">input vs output blocks · 1 block = 1,000 tokens</span></div>
        <div className="grid-2 mb-24">
          <div className="panel">
            <div className="panel-head"><div><div className="panel-title">By product</div><div className="panel-sub">input and output blocks by product</div></div><div className="legend"><span><span className="sw" style={{ background: "var(--tok-in)" }} />Input</span><span><span className="sw" style={{ background: "var(--tok-out)" }} />Output</span></div></div>
            <HStackBars rows={tokByProductRows} colors={{ a: "var(--tok-in)", b: "var(--tok-out)" }} unit="blocks" />
            <SummarizeButton panel="Token breakdown by product" context={{ tokenByProduct: usage.tokenByProduct }} />
          </div>
          <div className="panel">
            <div className="panel-head"><div><div className="panel-title">By model</div><div className="panel-sub">total input / output blocks</div></div></div>
            <HStackBars rows={tokByModel} colors={{ a: "var(--tok-in)", b: "var(--tok-out)" }} unit="blocks" labelWidth={92} rightPadding={44} />
          </div>
        </div>
      </MetricSection>

      {/* relationship */}
      <MetricSection group="relationship">
        <div className="section-head"><h2 className="eyebrow">Relationship</h2><span className="section-sub">prompts × tokens × revenue, per account</span></div>
        <div className="panel mb-24">
          <div className="panel-head"><div><div className="panel-title">Prompts vs tokens vs revenue</div><div className="panel-sub">each bubble = one Group 6 account</div></div></div>
          <RelationScatter points={usage.scatter} />
          <SummarizeButton panel="Prompts vs tokens vs revenue scatter" context={{ singleRumPlans: usage.derived.singleRumPlans, models: usage.models.map((m) => ({ model: m.modelLabel, blocks: m.tokenBlocks, prompts: m.prompts, revenue: m.revenueDue })) }} />
        </div>
      </MetricSection>

      {/* temporal allocation */}
      <MetricSection group="resourceAllocation">
        <div className="section-head"><h2 className="eyebrow">Resource allocation</h2><span className="section-sub">when to provision capacity for Odyssey 3.0 / 3.5</span></div>
        <div className="panel mb-24">
          <div className="panel-head">
            <div><div className="panel-title">Usage by hour of day</div><div className="panel-sub">events by event start hour (UTC) · model split by usage bucket · peaks outlined</div></div>
            <div className="legend"><span><span className="sw" style={{ background: "var(--m30)" }} />3.0</span><span><span className="sw" style={{ background: "var(--m35)" }} />3.5</span></div>
          </div>
          <VBars data={hourBars} colors={{ a: "var(--m30)", b: "var(--m35)", aLabel: "3.0", bLabel: "3.5" }} unit="events" height={150} labelEvery={2} />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            Peak hours <b className="mono">{formatHours(usage.peakHours)}</b> · quietest <b className="mono">{formatHourRanges(usage.derived.quietHours)}</b>{usage.derived.zeroHours.length ? <> · near-zero <b className="mono">{formatHourRanges(usage.derived.zeroHours)}</b></> : null}.
          </div>
          <SummarizeButton panel="Usage by hour of day (capacity allocation)" context={{ peakHours: usage.peakHours, quietHours: usage.derived.quietHours, zeroHours: usage.derived.zeroHours, byHour: usage.byHour }} />
        </div>
        <div className="grid-2-even mb-24">
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Usage by day of week</div><div className="panel-sub">{backfillNote}</div></div></div><VBars data={dowBars} colors={{ a: "var(--m35)" }} unit="events" height={130} /></div>
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Usage by week of month</div><div className="panel-sub">events by ordinal week</div></div></div><VBars data={weekBars} colors={{ a: "var(--m35)" }} unit="events" height={130} /></div>
        </div>
      </MetricSection>

      {/* usage-intensity buckets */}
      <MetricSection group="usageTiers">
        <div className="section-head"><h2 className="eyebrow">Usage intensity</h2><span className="section-sub">events by generated L01-L10 usage bucket</span></div>
        <div className="panel mb-24">
          <div className="panel-head"><div><div className="panel-title">Events by usage bucket</div><div className="panel-sub">L01-L10 marks simulated usage intensity, not plan tier</div></div><div className="legend"><span><span className="sw" style={{ background: "var(--m30)" }} />3.0</span><span><span className="sw" style={{ background: "var(--m35)" }} />3.5</span></div></div>
          <VBars data={tierBars} colors={{ a: "var(--m30)", b: "var(--m35)", aLabel: "3.0", bLabel: "3.5" }} unit="events" height={140} />
        </div>
      </MetricSection>

      {/* customers */}
      <MetricSection group="customers">
        <div className="section-head"><h2 className="eyebrow">Customers</h2><span className="section-sub">product and plan distribution</span></div>
        <div className="grid-2-even mb-24">
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Customers per product</div><div className="panel-sub">{usage.productMix.length} products</div></div></div><HBars rows={customerProductRows} color="var(--brand)" /></div>
          <div className="panel"><div className="panel-head"><div><div className="panel-title">Customers per plan</div><div className="panel-sub">{usage.usersByPlan.length} plans</div></div></div><HBars rows={customerPlanRows} color="var(--brand)" /></div>
        </div>
      </MetricSection>

      {/* data quality & exceptions */}
      <MetricSection group="dataQuality">
        <div className="section-head"><h2 className="eyebrow">Data quality &amp; exceptions</h2><span className="section-sub">real anomalies from the billing data</span></div>
        <div className="mb-24">
          <StatGrid>
            <StatTile label="Active customers" value={intGroup(st.active)} tone="good" dot sub={<><b>{intGroup(st.inactive)}</b> inactive · <b>{intGroup(st.closed)}</b> closed</>} />
            <StatTile label="Suspended subs" value={intGroup(ex.suspendedSubs)} tone={ex.suspendedSubs ? "warn" : "neutral"} dot sub="purchased products not active" />
            <StatTile label="Unrated usage" value={intGroup(ex.unratedUsage)} tone={ex.unratedUsage ? "warn" : "neutral"} dot sub="events with no rated charge" />
            <StatTile label="Orphan usage" value={intGroup(ex.orphanUsage)} tone={ex.orphanUsage ? "bad" : "good"} dot sub="usage with no valid account" />
            <StatTile label="Unpaid bills" value={intGroup(ex.failedTxns)} tone={ex.failedTxns ? "warn" : "good"} dot sub="received < total due" />
            <StatTile label="AIT not collected" value={money(tax.expected)} tone={tax.collected === 0 && tax.expected > 0 ? "bad" : "good"} dot sub={<>tagged on <b>{money(tax.taxableBase)}</b>, <b>{money(tax.collected)}</b> billed</>} />
          </StatGrid>
        </div>
      </MetricSection>

      {/* revenue, tax (AIT) */}
      <MetricSection group="tax">
        <div className="section-head"><h2 className="eyebrow">Tax · AIT</h2><span className="section-sub">Advanced Income Tax — configured {tax.ratePct}% Fed/US</span></div>
        <div className="mb-24">
          <StatGrid>
            <StatTile label="AIT taxable base" value={money(tax.taxableBase)} tone="brand" sub="USD charges tagged AIT" />
            <StatTile label="AIT collected" value={money(tax.collected)} tone={tax.collected === 0 && tax.taxableBase > 0 ? "bad" : "good"} sub="from EVENT_BILLING_TAXES_T" />
            <StatTile label={`Expected @ ${tax.ratePct}%`} value={money(tax.expected)} tone="neutral" sub="base × rate" />
            <StatTile label="Effective AIT rate" value={pct(tax.effectiveRatePct)} tone={tax.effectiveRatePct < tax.ratePct ? "warn" : "good"} sub={`vs ${tax.ratePct}% configured`} />
          </StatGrid>
        </div>
        <div className="grid-2 mb-24">
          <div className="panel">
            <div className="panel-head"><div><div className="panel-title">Revenue by jurisdiction</div><div className="panel-sub">billed due by bill-to state</div></div></div>
            <HBars rows={stateRows} color="var(--brand)" />
            <SummarizeButton panel="Tax / AIT and revenue by jurisdiction" context={{ tax: { base: tax.taxableBase, collected: tax.collected, expected: tax.expected, rate: tax.ratePct }, byState: tax.byState }} />
          </div>
          <div className="panel" style={{ overflow: "hidden", padding: 0 }}>
            <div className="tbl-scroll">
              <table className="tbl" style={{ border: 0 }}>
                <thead><tr><th scope="col">Tax code</th><th scope="col" className="num">Rate</th><th scope="col">Scope</th></tr></thead>
                <tbody>
                  {tax.codes.slice(0, 8).map((c, i) => (
                    <tr key={`${c.code}-${i}`}><th scope="row">{c.descr || c.code}</th><td className="num">{c.pct}%</td><td className="mono" style={{ color: "var(--muted)" }}>{c.level}/{c.list}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </MetricSection>

      {/* AR */}
      <MetricSection group="ar">
        <div className="section-head"><h2 className="eyebrow">Accounts receivable</h2><span className="section-sub">billed → collected → exceptions, from BILL_T</span></div>
        <div className="mb-24">
          <StatGrid>
            <StatTile label="Billed" value={money(ar.billed)} tone="neutral" sub="total due" />
            <StatTile label="Collected" value={money(ar.received)} tone={ar.received > 0 ? "good" : "warn"} sub="received" />
            <StatTile label="Outstanding" value={money(ar.outstanding)} tone={ar.outstanding > 0 ? "warn" : "good"} sub="billed − collected" />
            <StatTile label="Disputed" value={money(ar.disputed)} tone={ar.disputed > 0 ? "bad" : "good"} dot sub="flagged on bills" />
            <StatTile label="Written off" value={money(ar.writeoff)} tone={ar.writeoff > 0 ? "warn" : "good"} sub="uncollectable" />
            <StatTile label="Adjusted" value={money(ar.adjusted)} tone="neutral" sub="credits / corrections" />
          </StatGrid>
        </div>
      </MetricSection>

      {/* pricing */}
      <MetricSection group="pricing">
        <div className="section-head"><h2 className="eyebrow">Pricing</h2><span className="section-sub">list price vs realized ($ ÷ units billed)</span></div>
        <div className="tbl-wrap mb-24">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th scope="col">Product</th><th scope="col">Unit</th><th scope="col">List price</th><th scope="col" className="num">Realized $/unit</th><th scope="col" className="num">Revenue</th></tr></thead>
              <tbody>
                {usage.pricing.map((p, i) => (
                  <tr key={`${p.product}-${i}`}>
                    <th scope="row">{shortProduct(p.product)}</th>
                    <td className="mono" style={{ color: "var(--muted)" }}>{p.unit}</td>
                    <td className="mono">{p.listPrice || "—"}</td>
                    <td className="num">{p.realizedPrice ? `$${p.realizedPrice.toFixed(3)}` : "—"}</td>
                    <td className="num">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </MetricSection>

      {/* export */}
      <div className="section-head" id="export"><h2 className="eyebrow">Export</h2><span className="section-sub">download the underlying aggregates</span></div>
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div className="state-sub" style={{ textAlign: "left", margin: 0 }}>
            Daily prompts, tokens, and rated usage revenue for the selected window.
          </div>
          <ExportCsvButton rows={csvRows} filename="group6-daily-usage.csv" label="Export daily CSV" />
        </div>
      </div>
    </Shell>
  );
}

