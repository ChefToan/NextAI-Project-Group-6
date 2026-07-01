import "server-only";
import { runReadOnlyQuery } from "@/lib/oracle";
import { GROUP6_SERVICE_TYPE, group6ServiceWhere } from "@/lib/group6-scope";

type Row = Record<string, unknown>;

const SERVICE_TYPE = GROUP6_SERVICE_TYPE;
const G6_SERVICE_WHERE = group6ServiceWhere("s");

// Distinct Group 6 account ids (sub-select reused by bill/account queries).
const G6_ACCOUNTS = `select distinct a.poid_id0 from account_t a join service_t s on s.account_obj_id0 = a.poid_id0 where ${G6_SERVICE_WHERE}`;

// Core usage join: one row per Group 6 usage event, with model + token columns.
// EVENT_SESSION_USAGE_G6 (no "2") is empty; the populated subclass table is *USAGE2_G6.
// Kept as FROM + WHERE separately so extra JOINs (bal impacts, product map) can be
// inserted before the WHERE clause (a JOIN after WHERE is invalid SQL).
const USAGE_FROM = `event_t e join EVENT_SESSION_USAGE2_G6 u on u.OBJ_ID0 = e.poid_id0`;
const USAGE_WHERE = `where e.poid_type = '/event/session/usagegr6' and e.account_obj_id0 in (${G6_ACCOUNTS})`;
const USAGE_REV_JOIN = `join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0 and bi.resource_id = 840`;
const USAGE_CACHE_TTL_MS = 60_000;
const SLOW_QUERY_MS = 2_000;

const usageCache = new Map<string, { expiresAt: number; value: Group6Usage }>();

export type ModelKey = "3.0" | "3.5";

export type Group6Scatter = {
  acct: number;
  model: string;
  modelLabel: string;
  product: string;
  kind: string;
  prompts: number;
  tokenBlocks: number;
  revenue: number;
};

export type Group6Usage = {
  connected: boolean;
  generatedAt: string;
  windowUtc: { min: string; max: string; days: number };
  kpis: {
    revenueDue: number;
    usageRevenue: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalPrompts: number;
    usageEvents: number;
    activeUsers: number;
    totalUsers: number;
    avgRevenuePerUser: number;
    billCount: number;
    inputSharePct: number;
    activePct: number;
  };
  derived: {
    productCount: number;
    modelCount: number;
    medianDailyPrompts: number;
    backfillDays: string[];
    peakHours: number[];
    quietHours: number[];
    zeroHours: number[];
    modelSplit: Array<{ model: string; modelLabel: string; pct: number; events: number }>;
    singleRumPlans: boolean;
  };
  models: Array<{
    model: string;
    modelLabel: string;
    events: number;
    prompts: number;
    inputTokens: number;
    outputTokens: number;
    tokenBlocks: number;
    usageRevenue: number;
    users: number;
    revenueDue: number;
  }>;
  daily: Array<{ date: string; prompts: number; tokens: number; revenue: number }>;
  tokenByProduct: Array<{
    product: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  byHour: Array<{ hour: number; m30: number; m35: number }>;
  byDow: Array<{ dow: number; label: string; total: number }>;
  byWeek: Array<{ week: number; label: string; total: number }>;
  scatter: Group6Scatter[];
  productMix: Array<{
    product: string;
    model: string;
    kind: string;
    users: number;
    revenueDue: number;
    tokenBlocks: number;
    prompts: number;
  }>;
  peakHours: number[];
  availableRange: { min: string; max: string };
  statusBreakdown: { active: number; inactive: number; closed: number };
  suspendedSubs: number;
  usersByPlan: Array<{ plan: string; model: string; users: number; revenueDue: number }>;
  exceptions: { unratedUsage: number; orphanUsage: number; failedTxns: number; suspendedSubs: number };
  tax: {
    code: string;
    ratePct: number;
    taxableBase: number;
    collected: number;
    expected: number;
    effectiveRatePct: number;
    codes: Array<{ code: string; pct: number; level: string; list: string; descr: string }>;
    byState: Array<{ state: string; accounts: number; revenueDue: number; taxCollected: number }>;
  };
  ar: { billed: number; received: number; disputed: number; writeoff: number; adjusted: number; outstanding: number };
  pricing: Array<{ product: string; model: string; kind: string; unit: string; listPrice: string; realizedPrice: number; revenue: number; units: number }>;
  // Revenue split by BRM GL_ID (resource 840 USD impacts). Recurring vs usage is
  // taken from the GL account, not from event-type string matching.
  revenueByGl: Array<{ glId: string; label: string; kind: RevenueKind; usd: number; impacts: number; pct: number }>;
  revenueSplit: { recurring: number; usage: number; unassigned: number; other: number; total: number };
  // One enriched row per Group 6 account for the customer/account report.
  accounts: Array<{
    acct: number;
    login: string;
    product: string;
    plan: string;
    model: string;
    modelLabel: string;
    kind: string;
    accountStatus: string;
    serviceStatus: string;
    state: string;
    prompts: number;
    tokenBlocks: number;
    usageRevenue: number;
    recurringRevenue: number;
    unassignedRevenue: number;
    billedDue: number;
    received: number;
    outstanding: number;
  }>;
  notes: string[];
};

function n(v: unknown, f = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : f;
}
function s(v: unknown, f = "") {
  return v == null ? f : String(v);
}
function modelLabel(model: string) {
  return model ? `Odyssey ${model}` : "Unknown";
}
// Classify a Group 6 product name into a billing kind for grouping/colour.
function productKind(name: string) {
  const l = name.toLowerCase();
  if (l.includes("unlimited")) return "Unlimited";
  if (l.includes("payg") || l.includes("pay as you go")) return "PAYG";
  if (l.includes("monthly")) return "Monthly";
  return "Other";
}
const DOW = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// General-ledger classification of USD balance impacts (resource 840).
// Per finance guidance we split recurring vs usage revenue by BRM GL_ID rather
// than by matching event-type strings, and surface any revenue that landed on
// GL 0 (no GL account configured) as an exception to be corrected.
export type RevenueKind = "recurring" | "usage" | "unassigned" | "other";
const GL_REVENUE_CLASS: Record<string, { label: string; kind: RevenueKind }> = {
  "102": { label: "Recurring subscription (GL 102)", kind: "recurring" },
  "104": { label: "Usage / consumption (GL 104)", kind: "usage" },
  "0": { label: "Unassigned GL (GL 0)", kind: "unassigned" },
};
export function classifyGl(glId: string): { label: string; kind: RevenueKind } {
  return GL_REVENUE_CLASS[glId] ?? { label: `GL ${glId}`, kind: "other" };
}

// Pull a human list price out of a product description, e.g. "$0.70 per prompt",
// "$0.07 per each block of 1000 tokens", "$100/month". Falls back to "" .
function parsePrice(descr: string): string {
  if (!descr) return "";
  const m = descr.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:per|\/)\s?[\w\s]{0,18})?/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function queryLabel(sql: string) {
  return sql.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ").slice(0, 120);
}

async function rows(sql: string, max = 500): Promise<Row[]> {
  const started = Date.now();
  const r = await runReadOnlyQuery(sql, max);
  const elapsed = Date.now() - started;
  const label = queryLabel(sql);
  if (process.env.NODE_ENV !== "production") {
    console.info(`[group6-usage] ${elapsed}ms ${label}`);
  }
  if (elapsed > SLOW_QUERY_MS) {
    console.warn(`[group6-usage] slow query ${elapsed}ms ${label}`);
  }
  return (r?.rows ?? []) as Row[];
}

export type UsageRange = { from?: number; to?: number };

export function clearGroup6UsageCache() {
  usageCache.clear();
}

export async function getGroup6Usage(range: UsageRange = {}): Promise<Group6Usage> {
  const started = Date.now();
  const generatedAt = new Date().toISOString();
  // Optional billing-period filter on real session start time (epoch seconds).
  const from = Number.isFinite(range.from) ? Math.floor(range.from as number) : null;
  const to = Number.isFinite(range.to) ? Math.floor(range.to as number) : null;
  const cacheKey = `${from ?? ""}:${to ?? ""}`;
  const cached = usageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[group6-usage] cache hit ${cacheKey}`);
    }
    return cached.value;
  }
  const rangeClause = `${from != null ? ` and e.start_t >= ${from}` : ""}${to != null ? ` and e.start_t <= ${to}` : ""}`;
  const W = `${USAGE_WHERE}${rangeClause}`;
  const empty: Group6Usage = {
    connected: false,
    generatedAt,
    windowUtc: { min: "", max: "", days: 0 },
    kpis: {
      revenueDue: 0, usageRevenue: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0,
      totalPrompts: 0, usageEvents: 0, activeUsers: 0, totalUsers: 0, avgRevenuePerUser: 0,
      billCount: 0, inputSharePct: 0, activePct: 0,
    },
    derived: {
      productCount: 0, modelCount: 0, medianDailyPrompts: 0,
      backfillDays: [], peakHours: [], quietHours: [], zeroHours: [], modelSplit: [], singleRumPlans: true,
    },
    models: [], daily: [], tokenByProduct: [], byHour: [], byDow: [], byWeek: [],
    scatter: [], productMix: [], peakHours: [],
    availableRange: { min: "", max: "" },
    statusBreakdown: { active: 0, inactive: 0, closed: 0 },
    suspendedSubs: 0,
    usersByPlan: [],
    exceptions: { unratedUsage: 0, orphanUsage: 0, failedTxns: 0, suspendedSubs: 0 },
    tax: { code: "AIT", ratePct: 5, taxableBase: 0, collected: 0, expected: 0, effectiveRatePct: 0, codes: [], byState: [] },
    ar: { billed: 0, received: 0, disputed: 0, writeoff: 0, adjusted: 0, outstanding: 0 },
    pricing: [],
    revenueByGl: [],
    revenueSplit: { recurring: 0, usage: 0, unassigned: 0, other: 0, total: 0 },
    accounts: [],
    notes: [],
  };

  // KPI scalars + account status counts + billed revenue.
  const headlineRows = await rows(
    `select 'window_min' k, to_char(date '1970-01-01' + min(e.start_t)/86400,'YYYY-MM-DD HH24:MI') v from ${USAGE_FROM} ${W}
     union all select 'window_max', to_char(date '1970-01-01' + max(e.start_t)/86400,'YYYY-MM-DD HH24:MI') from ${USAGE_FROM} ${W}
     union all select 'window_days', to_char(count(distinct trunc(date '1970-01-01' + e.start_t/86400))) from ${USAGE_FROM} ${W}
     union all select 'usage_events', to_char(count(*)) from ${USAGE_FROM} ${W}
     union all select 'prompts', to_char(sum(case when e.rum_name = 'PromptG6' then 1 else 0 end)) from ${USAGE_FROM} ${W}
     union all select 'input_tokens', to_char(sum(u.input_tokens2_g6)) from ${USAGE_FROM} ${W}
     union all select 'output_tokens', to_char(sum(u.output_tokens2_g6)) from ${USAGE_FROM} ${W}
     union all select 'usage_revenue', to_char(round((select sum(bi.amount) from event_bal_impacts_t bi join event_t e2 on e2.poid_id0 = bi.obj_id0 where e2.poid_type = '/event/session/usagegr6' and e2.account_obj_id0 in (${G6_ACCOUNTS}) and bi.resource_id = 840),2)) from dual
     union all select 'revenue_due', to_char(round((select sum(total_due) from bill_t where account_obj_id0 in (${G6_ACCOUNTS})),2)) from dual
     union all select 'total_users', to_char((select count(*) from (${G6_ACCOUNTS}))) from dual
     union all select 'active_users', to_char((select count(*) from account_t where status = 10100 and poid_id0 in (${G6_ACCOUNTS}))) from dual
     union all select 'bills', to_char((select count(*) from bill_t where account_obj_id0 in (${G6_ACCOUNTS}))) from dual`,
    40,
  );

  if (headlineRows.length === 0) return empty;
  const H: Record<string, string> = {};
  for (const r of headlineRows) H[s(r.K)] = s(r.V);

  // Per-model usage aggregates.
  const modelRows = await rows(
    `select u.model_code2_g6 model, count(*) events,
            sum(case when e.rum_name = 'PromptG6' then 1 else 0 end) prompts,
            sum(u.input_tokens2_g6) in_tok, sum(u.output_tokens2_g6) out_tok,
            count(distinct e.account_obj_id0) users
       from ${USAGE_FROM} ${W} group by u.model_code2_g6 order by u.model_code2_g6`,
  );
  const modelRevRows = await rows(
    `select u.model_code2_g6 model, round(sum(bi.amount),2) usd
       from ${USAGE_FROM} ${USAGE_REV_JOIN} ${W}
      group by u.model_code2_g6`,
  );
  const modelRev: Record<string, number> = {};
  for (const r of modelRevRows) modelRev[s(r.MODEL)] = n(r.USD);

  // Daily usage series (by real session start_t).
  const dailyRows = await rows(
    `select to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM-DD') d,
            sum(case when e.rum_name = 'PromptG6' then 1 else 0 end) prompts,
            sum(u.input_tokens2_g6 + u.output_tokens2_g6) tokens
       from ${USAGE_FROM} ${W} group by to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM-DD') order by d`,
  );
  const dailyRevRows = await rows(
    `select to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM-DD') d, round(sum(bi.amount),2) rev
       from ${USAGE_FROM} ${USAGE_REV_JOIN} ${W}
      group by to_char(date '1970-01-01' + e.start_t/86400,'YYYY-MM-DD')`,
  );
  const dailyRev: Record<string, number> = {};
  for (const r of dailyRevRows) dailyRev[s(r.D)] = n(r.REV);

  // Temporal breakdowns by real session start_t.
  const hourRows = await rows(
    `select to_number(to_char(date '1970-01-01' + e.start_t/86400,'HH24')) hr, u.model_code2_g6 model, count(*) nn
       from ${USAGE_FROM} ${W} group by to_number(to_char(date '1970-01-01' + e.start_t/86400,'HH24')), u.model_code2_g6`,
  );
  const dowRows = await rows(
    `select to_number(to_char(date '1970-01-01' + e.start_t/86400,'D')) dow, count(*) nn
       from ${USAGE_FROM} ${W} group by to_number(to_char(date '1970-01-01' + e.start_t/86400,'D')) order by dow`,
  );
  const weekRows = await rows(
    `select to_number(to_char(date '1970-01-01' + e.start_t/86400,'W')) wk, count(*) nn
       from ${USAGE_FROM} ${W} group by to_number(to_char(date '1970-01-01' + e.start_t/86400,'W')) order by wk`,
  );

  // Per-account aggregates (for scatter / product mix).
  const acctRows = await rows(
    `select e.account_obj_id0 acct, max(u.model_code2_g6) model,
            sum(case when e.rum_name = 'PromptG6' then 1 else 0 end) prompts,
            sum(u.input_tokens2_g6) input_tokens,
            sum(u.output_tokens2_g6) output_tokens,
            sum(u.input_tokens2_g6 + u.output_tokens2_g6) tokens
       from ${USAGE_FROM} ${W} group by e.account_obj_id0`,
    1000,
  );
  const acctRevRows = await rows(
    `select e.account_obj_id0 acct, round(sum(bi.amount),2) usd
       from ${USAGE_FROM} ${USAGE_REV_JOIN} ${W}
      group by e.account_obj_id0`,
    1000,
  );
  const acctBillRows = await rows(
    `select account_obj_id0 acct, round(sum(total_due),2) due, round(sum(nvl(recvd,0)),2) recvd from bill_t where account_obj_id0 in (${G6_ACCOUNTS}) group by account_obj_id0`,
    1000,
  );
  const acctProductRows = await rows(
    `select s.account_obj_id0 acct, min(p.name) product
       from service_t s
       join purchased_product_t pp on pp.service_obj_id0 = s.poid_id0
       join product_t p on p.poid_id0 = pp.product_obj_id0
      where ${G6_SERVICE_WHERE}
      group by s.account_obj_id0`,
    1000,
  );

  // ---- assemble per-account ----
  const acctRev: Record<number, number> = {};
  for (const r of acctRevRows) acctRev[n(r.ACCT)] = n(r.USD);
  const acctDue: Record<number, number> = {};
  const acctReceived: Record<number, number> = {};
  for (const r of acctBillRows) {
    acctDue[n(r.ACCT)] = n(r.DUE);
    acctReceived[n(r.ACCT)] = n(r.RECVD);
  }
  const acctProduct: Record<number, string> = {};
  for (const r of acctProductRows) acctProduct[n(r.ACCT)] = s(r.PRODUCT, "Unmapped product");

  const scatter: Group6Scatter[] = acctRows.map((r) => {
    const acct = n(r.ACCT);
    const product = acctProduct[acct] ?? "Unmapped product";
    const model = s(r.MODEL);
    return {
      acct,
      model,
      modelLabel: modelLabel(model),
      product,
      kind: productKind(product),
      prompts: n(r.PROMPTS),
      tokenBlocks: Math.round((n(r.TOKENS) / 1000) * 100) / 100,
      revenue: acctDue[acct] ?? 0,
    };
  });

  // ---- product mix (group subscribed accounts by product) ----
  const mixMap = new Map<string, { product: string; model: string; kind: string; users: number; revenueDue: number; tokenBlocks: number; prompts: number }>();
  const scatterByAcct = new Map(scatter.map((row) => [row.acct, row]));
  for (const acctStr of Object.keys(acctProduct)) {
    const acct = Number(acctStr);
    const row = scatterByAcct.get(acct);
    const product = acctProduct[acct] ?? row?.product ?? "Unmapped product";
    const cur = mixMap.get(product) ?? {
      product,
      model: row?.model || (product.includes("3.5") ? "3.5" : "3.0"),
      kind: productKind(product),
      users: 0, revenueDue: 0, tokenBlocks: 0, prompts: 0,
    };
    cur.users += 1;
    cur.revenueDue += acctDue[acct] ?? 0;
    cur.tokenBlocks += row?.tokenBlocks ?? 0;
    cur.prompts += row?.prompts ?? 0;
    mixMap.set(product, cur);
  }
  const productMix = [...mixMap.values()]
    .map((m) => ({ ...m, revenueDue: Math.round(m.revenueDue * 100) / 100, tokenBlocks: Math.round(m.tokenBlocks * 100) / 100 }))
    .sort((a, b) => b.revenueDue - a.revenueDue);

  // ---- token breakdown by product (token-billed products carry tokens) ----
  // Avoid the slow event-grain product join: account-level token totals and
  // account->product mapping are already available and preserve the same chart shape.
  const tokenByProductMap = new Map<string, { product: string; model: string; inputTokens: number; outputTokens: number }>();
  for (const r of acctRows) {
    const acct = n(r.ACCT);
    const product = acctProduct[acct] ?? "Unmapped product";
    const model = s(r.MODEL) || (product.includes("3.5") ? "3.5" : "3.0");
    const inputTokensForAcct = n(r.INPUT_TOKENS);
    const outputTokensForAcct = n(r.OUTPUT_TOKENS);
    if (inputTokensForAcct + outputTokensForAcct <= 0) continue;
    const key = `${product}\u0000${model}`;
    const cur = tokenByProductMap.get(key) ?? { product, model, inputTokens: 0, outputTokens: 0 };
    cur.inputTokens += inputTokensForAcct;
    cur.outputTokens += outputTokensForAcct;
    tokenByProductMap.set(key, cur);
  }
  const tokenByProduct = [...tokenByProductMap.values()].sort(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );

  // ---- temporal assembly ----
  const hourMap = new Map<number, { m30: number; m35: number }>();
  for (let h = 0; h < 24; h++) hourMap.set(h, { m30: 0, m35: 0 });
  for (const r of hourRows) {
    const h = n(r.HR);
    const slot = hourMap.get(h)!;
    if (s(r.MODEL) === "3.5") slot.m35 += n(r.NN);
    else slot.m30 += n(r.NN);
  }
  const byHour = [...hourMap.entries()].map(([hour, v]) => ({ hour, ...v }));

  const byDow = dowRows.map((r) => ({ dow: n(r.DOW), label: DOW[n(r.DOW)] ?? String(n(r.DOW)), total: n(r.NN) }));
  const byWeek = weekRows.map((r) => ({ week: n(r.WK), label: `Wk ${n(r.WK)}`, total: n(r.NN) }));

  // ---- models ----
  const models = modelRows.map((r) => {
    const model = s(r.MODEL);
    const inputTokens = n(r.IN_TOK);
    const outputTokens = n(r.OUT_TOK);
    const revenueDue = scatter
      .filter((x) => x.model === model)
      .reduce((acc, x) => acc + x.revenue, 0);
    return {
      model,
      modelLabel: modelLabel(model),
      events: n(r.EVENTS),
      prompts: n(r.PROMPTS),
      inputTokens,
      outputTokens,
      tokenBlocks: Math.round(((inputTokens + outputTokens) / 1000) * 100) / 100,
      usageRevenue: modelRev[model] ?? 0,
      users: n(r.USERS),
      revenueDue: Math.round(revenueDue * 100) / 100,
    };
  });

  const daily = dailyRows.map((r) => ({
    date: s(r.D),
    prompts: n(r.PROMPTS),
    tokens: n(r.TOKENS),
    revenue: dailyRev[s(r.D)] ?? 0,
  }));

  // peak hours = top 3 hours by total events
  const peakHours = [...byHour]
    .sort((a, b) => b.m30 + b.m35 - (a.m30 + a.m35))
    .slice(0, 3)
    .map((x) => x.hour)
    .sort((a, b) => a - b);

  const inputTokens = n(H.input_tokens);
  const outputTokens = n(H.output_tokens);
  const totalUsers = n(H.total_users);
  const revenueDue = n(H.revenue_due);
  const activeUsers = n(H.active_users);
  const totalTokens = inputTokens + outputTokens;
  const usageEvents = n(H.usage_events);

  // ---- derived facts (replace previously hardcoded strings) ----
  const promptSeries = daily.map((d) => d.prompts).sort((a, b) => a - b);
  const medianDailyPrompts = promptSeries.length
    ? promptSeries[Math.floor(promptSeries.length / 2)]
    : 0;
  // auto-detect bulk-backfill days: prompts far above the typical day
  const backfillDays = daily
    .filter((d) => medianDailyPrompts > 0 && d.prompts > medianDailyPrompts * 2.2)
    .map((d) => d.date);

  const hourTotals = byHour.map((h) => ({ hour: h.hour, total: h.m30 + h.m35 }));
  const peakHoursFull = [...hourTotals].sort((a, b) => b.total - a.total).slice(0, 3).map((h) => h.hour).sort((a, b) => a - b);
  const zeroHours = hourTotals.filter((h) => h.total === 0).map((h) => h.hour);
  const quietHours = [...hourTotals]
    .filter((h) => h.total > 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, 3)
    .map((h) => h.hour)
    .sort((a, b) => a - b);

  const modelEventTotal = models.reduce((acc, m) => acc + m.events, 0) || 1;
  const modelSplit = models.map((m) => ({
    model: m.model,
    modelLabel: m.modelLabel,
    events: m.events,
    pct: Math.round((m.events / modelEventTotal) * 100),
  }));

  // single-RUM = no account mixes prompt billing and token billing
  const singleRumPlans = scatter.every((x) => x.prompts === 0 || x.tokenBlocks === 0);

  // ===== additive metrics (Batch 1): date bounds, status, plan, tax(AIT), AR, pricing =====
  const rangeRows = await rows(
    `select to_char(date '1970-01-01' + min(e.start_t)/86400,'YYYY-MM-DD') mn,
            to_char(date '1970-01-01' + max(e.start_t)/86400,'YYYY-MM-DD') mx
       from event_t e where e.poid_type = '/event/session/usagegr6' and e.account_obj_id0 in (${G6_ACCOUNTS})`, 2);
  const availableRange = { min: s(rangeRows[0]?.MN), max: s(rangeRows[0]?.MX) };

  const statusRows = await rows(
    `select a.status st, count(*) n from account_t a where a.poid_id0 in (${G6_ACCOUNTS}) group by a.status`, 20);
  let stActive = 0, stInactive = 0, stClosed = 0;
  for (const r of statusRows) { const st = n(r.ST), c = n(r.N); if (st === 10100) stActive += c; else if (st === 10102) stInactive += c; else if (st === 10103) stClosed += c; }
  const statusBreakdown = { active: stActive, inactive: stInactive, closed: stClosed };

  const subRows = await rows(
    `select count(*) total, sum(case when pp.status = 1 then 1 else 0 end) active
       from purchased_product_t pp join service_t s on s.poid_id0 = pp.service_obj_id0
      where ${G6_SERVICE_WHERE}`, 2);
  const suspendedSubs = Math.max(0, n(subRows[0]?.TOTAL) - n(subRows[0]?.ACTIVE));

  const acctPlanRows = await rows(
    `select pp.account_obj_id0 acct, min(pl.name) plan
       from purchased_product_t pp
       join service_t s on s.poid_id0 = pp.service_obj_id0
       join plan_t pl on pl.poid_id0 = pp.plan_obj_id0
      where ${G6_SERVICE_WHERE} group by pp.account_obj_id0`, 1000);
  const acctPlan: Record<number, string> = {};
  for (const r of acctPlanRows) acctPlan[n(r.ACCT)] = s(r.PLAN, "Unmapped plan");

  const acctStateRows = await rows(
    `select obj_id0 acct, nvl(state,'N/A') state from account_nameinfo_t where obj_id0 in (${G6_ACCOUNTS})`, 1000);
  const acctState: Record<number, string> = {};
  for (const r of acctStateRows) acctState[n(r.ACCT)] = s(r.STATE, "N/A");

  const planMap = new Map<string, { plan: string; model: string; users: number; revenueDue: number }>();
  for (const acctStr of Object.keys(acctProduct)) {
    const acct = Number(acctStr);
    const plan = acctPlan[acct] ?? acctProduct[acct] ?? "Unmapped plan";
    const cur = planMap.get(plan) ?? { plan, model: plan.includes("3.5") ? "3.5" : "3.0", users: 0, revenueDue: 0 };
    cur.users += 1;
    cur.revenueDue += acctDue[acct] ?? 0;
    planMap.set(plan, cur);
  }
  const usersByPlan = [...planMap.values()]
    .map((p) => ({ ...p, revenueDue: Math.round(p.revenueDue * 100) / 100 }))
    .sort((a, b) => b.users - a.users || b.revenueDue - a.revenueDue);

  const ratedEventRows = await rows(
    `select count(distinct e.poid_id0) rated
       from ${USAGE_FROM}
       join event_bal_impacts_t bi on bi.obj_id0 = e.poid_id0
      ${W}`,
    2,
  );
  const orphanRows = await rows(
    `select count(*) orphan
       from ${USAGE_FROM}
       left join account_t a on a.poid_id0 = e.account_obj_id0
      ${W} and a.poid_id0 is null`,
    2,
  );
  const overdueRows = await rows(
    `select count(*) overdue
       from bill_t
      where account_obj_id0 in (${G6_ACCOUNTS})
        and total_due > 0
        and nvl(recvd,0) < total_due`,
    2,
  );
  const exceptions = {
    unratedUsage: Math.max(0, usageEvents - n(ratedEventRows[0]?.RATED)),
    orphanUsage: n(orphanRows[0]?.ORPHAN),
    failedTxns: n(overdueRows[0]?.OVERDUE),
    suspendedSubs,
  };

  const taxRows = await rows(
    `select 'base' k, to_char(round(nvl(sum(bi.amount),0),2)) v from event_bal_impacts_t bi where bi.account_obj_id0 in (${G6_ACCOUNTS}) and bi.resource_id = 840 and bi.tax_code = 'AIT' and nvl(bi.rate_tag,'x') <> 'Tax'
     union all select 'collected', to_char(round(nvl((select sum(amount) from EVENT_BILLING_TAXES_T where account_obj_id0 in (${G6_ACCOUNTS}) and tax_code = 'AIT'),0),2)) from dual`, 5);
  const TAX: Record<string, number> = {};
  for (const r of taxRows) TAX[s(r.K)] = n(r.V);
  const aitBase = TAX.base ?? 0;
  const aitCollected = TAX.collected ?? 0;
  const aitRatePct = 5;
  const taxCodeRows = await rows(
    `select tax_code code, percent pct, tax_level lvl, list lst, descr from CONFIG_TAXCODES_MAP_T where percent > 0 order by tax_code, percent`, 40);
  const seenCode = new Set<string>();
  const taxCodes: Array<{ code: string; pct: number; level: string; list: string; descr: string }> = [];
  for (const r of taxCodeRows) {
    const key = `${s(r.CODE)}|${n(r.PCT)}|${s(r.LST)}`;
    if (seenCode.has(key)) continue;
    seenCode.add(key);
    taxCodes.push({ code: s(r.CODE), pct: n(r.PCT), level: s(r.LVL), list: s(r.LST), descr: s(r.DESCR) });
  }
  const stateMap = new Map<string, { state: string; accounts: number; revenueDue: number; taxCollected: number }>();
  for (const acctStr of Object.keys(acctProduct)) {
    const acct = Number(acctStr);
    const st = acctState[acct] ?? "N/A";
    const cur = stateMap.get(st) ?? { state: st, accounts: 0, revenueDue: 0, taxCollected: 0 };
    cur.accounts += 1;
    cur.revenueDue += acctDue[acct] ?? 0;
    stateMap.set(st, cur);
  }
  const tax = {
    code: "AIT",
    ratePct: aitRatePct,
    taxableBase: aitBase,
    collected: aitCollected,
    expected: Math.round(aitBase * (aitRatePct / 100) * 100) / 100,
    effectiveRatePct: aitBase ? Math.round((aitCollected / aitBase) * 10000) / 100 : 0,
    codes: taxCodes,
    byState: [...stateMap.values()].map((x) => ({ ...x, revenueDue: Math.round(x.revenueDue * 100) / 100 })).sort((a, b) => b.revenueDue - a.revenueDue),
  };

  const arRows = await rows(
    `select round(nvl(sum(total_due),0),2) billed, round(nvl(sum(recvd),0),2) received, round(nvl(sum(disputed),0),2) disputed,
            round(nvl(sum(writeoff),0),2) writeoff, round(nvl(sum(adjusted),0),2) adjusted
       from bill_t where account_obj_id0 in (${G6_ACCOUNTS})`, 2);
  const ar = {
    billed: n(arRows[0]?.BILLED), received: n(arRows[0]?.RECEIVED), disputed: n(arRows[0]?.DISPUTED),
    writeoff: n(arRows[0]?.WRITEOFF), adjusted: n(arRows[0]?.ADJUSTED),
    outstanding: Math.round((n(arRows[0]?.BILLED) - n(arRows[0]?.RECEIVED)) * 100) / 100,
  };

  // ---- revenue split by GL_ID (recurring vs usage, per finance guidance) ----
  // Resource 840 = USD. Classify by GL account, not by event-type string.
  const glRevRows = await rows(
    `select nvl(to_char(bi.gl_id),'0') gl_id, round(sum(bi.amount),2) usd, count(*) impacts
       from event_bal_impacts_t bi
       join event_t e on e.poid_id0 = bi.obj_id0
      where e.account_obj_id0 in (${G6_ACCOUNTS}) and bi.resource_id = 840
      group by nvl(to_char(bi.gl_id),'0')`,
    50,
  );
  const glRevTotal = glRevRows.reduce((acc, r) => acc + n(r.USD), 0) || 1;
  const revenueByGl = glRevRows
    .map((r) => {
      const glId = s(r.GL_ID, "0");
      const info = classifyGl(glId);
      const usd = Math.round(n(r.USD) * 100) / 100;
      return { glId, label: info.label, kind: info.kind, usd, impacts: n(r.IMPACTS), pct: Math.round((usd / glRevTotal) * 1000) / 10 };
    })
    .sort((a, b) => b.usd - a.usd);
  const revenueSplit = revenueByGl.reduce(
    (acc, r) => {
      acc[r.kind] = Math.round((acc[r.kind] + r.usd) * 100) / 100;
      acc.total = Math.round((acc.total + r.usd) * 100) / 100;
      return acc;
    },
    { recurring: 0, usage: 0, unassigned: 0, other: 0, total: 0 },
  );

  // ---- per-account GL revenue (recurring / usage / unassigned) ----
  const acctGlRows = await rows(
    `select e.account_obj_id0 acct, nvl(to_char(bi.gl_id),'0') gl_id, round(sum(bi.amount),2) usd
       from event_bal_impacts_t bi
       join event_t e on e.poid_id0 = bi.obj_id0
      where e.account_obj_id0 in (${G6_ACCOUNTS}) and bi.resource_id = 840
      group by e.account_obj_id0, nvl(to_char(bi.gl_id),'0')`,
    2000,
  );
  const acctRecurring: Record<number, number> = {};
  const acctUsageRev: Record<number, number> = {};
  const acctUnassigned: Record<number, number> = {};
  for (const r of acctGlRows) {
    const acct = n(r.ACCT);
    const kind = classifyGl(s(r.GL_ID, "0")).kind;
    const usd = n(r.USD);
    if (kind === "recurring") acctRecurring[acct] = (acctRecurring[acct] ?? 0) + usd;
    else if (kind === "usage") acctUsageRev[acct] = (acctUsageRev[acct] ?? 0) + usd;
    else acctUnassigned[acct] = (acctUnassigned[acct] ?? 0) + usd;
  }

  // ---- per-account identity + status (all Group 6 accounts) ----
  const acctInfoRows = await rows(
    `select a.poid_id0 acct, a.status acct_status, s.status svc_status, lower(s.login) login
       from account_t a join service_t s on s.account_obj_id0 = a.poid_id0
      where ${G6_SERVICE_WHERE}`,
    1000,
  );
  const acctLogin: Record<number, string> = {};
  const acctStatusN: Record<number, number> = {};
  const svcStatusN: Record<number, number> = {};
  for (const r of acctInfoRows) {
    const acct = n(r.ACCT);
    acctLogin[acct] = s(r.LOGIN);
    acctStatusN[acct] = n(r.ACCT_STATUS);
    svcStatusN[acct] = n(r.SVC_STATUS);
  }
  const statusText = (st: number) => (st === 10100 ? "Active" : st === 10102 ? "Inactive" : st === 10103 ? "Closed" : st ? `Status ${st}` : "Unknown");

  // ---- assemble enriched per-account rows for the customer/account report ----
  const accounts = Object.keys(acctProduct)
    .map((acctStr) => {
      const acct = Number(acctStr);
      const row = scatterByAcct.get(acct);
      const product = acctProduct[acct] ?? row?.product ?? "Unmapped product";
      const model = row?.model || (product.includes("3.5") ? "3.5" : "3.0");
      const billedDue = Math.round((acctDue[acct] ?? 0) * 100) / 100;
      const received = Math.round((acctReceived[acct] ?? 0) * 100) / 100;
      return {
        acct,
        login: acctLogin[acct] ?? "",
        product,
        plan: acctPlan[acct] ?? "Unmapped plan",
        model,
        modelLabel: modelLabel(model),
        kind: productKind(product),
        accountStatus: statusText(acctStatusN[acct] ?? 0),
        serviceStatus: statusText(svcStatusN[acct] ?? 0),
        state: acctState[acct] ?? "N/A",
        prompts: row?.prompts ?? 0,
        tokenBlocks: row?.tokenBlocks ?? 0,
        usageRevenue: Math.round((acctUsageRev[acct] ?? 0) * 100) / 100,
        recurringRevenue: Math.round((acctRecurring[acct] ?? 0) * 100) / 100,
        unassignedRevenue: Math.round((acctUnassigned[acct] ?? 0) * 100) / 100,
        billedDue,
        received,
        outstanding: Math.round((billedDue - received) * 100) / 100,
      };
    })
    .sort((a, b) => b.billedDue - a.billedDue || a.acct - b.acct);

  const prodDescrRows = await rows(
    `select name, descr from product_t where permitted = '${SERVICE_TYPE}' or lower(name) like '%group 6%'`, 60);
  const descrByProduct: Record<string, string> = {};
  for (const r of prodDescrRows) descrByProduct[s(r.NAME)] = s(r.DESCR);
  const pricing = productMix.map((m) => {
    const isToken = /token/i.test(m.product);
    const units = isToken ? m.tokenBlocks : m.prompts;
    return {
      product: m.product, model: m.model, kind: m.kind,
      unit: isToken ? "1k-token block" : "prompt",
      listPrice: parsePrice(descrByProduct[m.product] ?? ""),
      realizedPrice: units > 0 ? Math.round((m.revenueDue / units) * 1000) / 1000 : 0,
      revenue: m.revenueDue, units,
    };
  });

  const result: Group6Usage = {
    connected: true,
    generatedAt,
    windowUtc: { min: H.window_min ?? "", max: H.window_max ?? "", days: n(H.window_days) },
    kpis: {
      revenueDue,
      usageRevenue: n(H.usage_revenue),
      totalTokens,
      inputTokens,
      outputTokens,
      totalPrompts: n(H.prompts),
      usageEvents,
      activeUsers,
      totalUsers,
      avgRevenuePerUser: totalUsers ? Math.round((revenueDue / totalUsers) * 100) / 100 : 0,
      billCount: n(H.bills),
      inputSharePct: totalTokens ? Math.round((inputTokens / totalTokens) * 100) : 0,
      activePct: totalUsers ? Math.round((activeUsers / totalUsers) * 100) : 0,
    },
    derived: {
      productCount: productMix.length,
      modelCount: models.length,
      medianDailyPrompts,
      backfillDays,
      peakHours: peakHoursFull,
      quietHours,
      zeroHours,
      modelSplit,
      singleRumPlans,
    },
    models,
    daily,
    tokenByProduct,
    byHour,
    byDow,
    byWeek,
    scatter,
    productMix,
    peakHours: peakHoursFull,
    availableRange,
    statusBreakdown,
    suspendedSubs,
    usersByPlan,
    exceptions,
    tax,
    ar,
    pricing,
    revenueByGl,
    revenueSplit,
    accounts,
    notes: [
      `Scope: all ${totalUsers} Group 6 accounts on /service/nextaig6.`,
      "Temporal charts bucket by event start time (real simulated session time), not load time.",
      backfillDays.length
        ? `Day-of-week and daily counts include a bulk backfill (${backfillDays.length} day${backfillDays.length > 1 ? "s" : ""}); hour-of-day is the reliable allocation signal.`
        : "Hour-of-day is the primary capacity-allocation signal.",
      "Revenue KPI is billed total due from BILL_T; time-resolved revenue uses rated usage impacts (USD resource 840).",
    ],
  };

  usageCache.set(cacheKey, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, value: result });
  if (process.env.NODE_ENV !== "production") {
    console.info(`[group6-usage] total ${Date.now() - started}ms ${cacheKey}`);
  }
  return result;
}

// Helper: format an hour list like [12,13,14] as "12:00, 13:00, 14:00".
export function formatHours(hours: number[]): string {
  return hours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ");
}

// Helper: collapse a sorted hour list into ranges like "08:00-10:00".
export function formatHourRanges(hours: number[]): string {
  if (hours.length === 0) return "";
  const sorted = [...hours].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    ranges.push(start === prev ? `${String(start).padStart(2, "0")}:00` : `${String(start).padStart(2, "0")}:00-${String(prev).padStart(2, "0")}:00`);
    if (i < sorted.length) {
      start = sorted[i];
      prev = sorted[i];
    }
  }
  return ranges.join(", ");
}

