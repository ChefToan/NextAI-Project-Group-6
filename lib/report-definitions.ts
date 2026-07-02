import type { Group6Dashboard } from "@/lib/brm-group6";
import type { Group6Usage } from "@/lib/group6-usage";

export type ReportType =
  | "dailyUsage"
  | "customerSummary"
  | "revenueByGl"
  | "revenueTaxAr"
  | "pricing"
  | "dataQuality"
  | "glLookup";

export type ReportRow = Record<string, string | number | null>;

export type ReportField = {
  id: string;
  label: string;
  group: string;
};

// A field whose value is derived from other fields in the same row. Users opt in
// to these; they are computed after the base rows are built and before filtering.
export type ComputedField = ReportField & {
  deps: string[];
  compute: (row: ReportRow) => string | number | null;
};

// Declarative, per-report filters rendered dynamically by the builder UI and
// applied generically on the server. `field` is the row key the filter targets.
export type ReportFilterKind = "text" | "id" | "enum" | "numberRange";
export type ReportFilter = {
  field: string;
  label: string;
  kind: ReportFilterKind;
  options?: string[];
  placeholder?: string;
};

// Text/id/enum filters carry a string; numberRange carries optional bounds.
export type FilterValue = string | { min?: string; max?: string };

export type ReportSort = { field: string; dir: "asc" | "desc" };

export type ReportDefinition = {
  id: ReportType;
  label: string;
  description: string;
  fields: ReportField[];
  defaultFields: string[];
  filters?: ReportFilter[];
  computed?: ComputedField[];
};

export const MAX_REPORT_ROWS = 5000;

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: "dailyUsage",
    label: "Daily usage",
    description: "Daily prompt, token, and rated usage totals for the selected date range.",
    fields: [
      { id: "date", label: "Date", group: "Time" },
      { id: "prompts", label: "Prompts", group: "Usage" },
      { id: "tokens", label: "Tokens", group: "Usage" },
      { id: "token_blocks", label: "Token blocks (1k)", group: "Usage" },
      { id: "usage_revenue_usd", label: "Usage revenue USD", group: "Revenue" },
      { id: "cumulative_usage_usd", label: "Cumulative usage USD", group: "Revenue" },
    ],
    defaultFields: ["date", "prompts", "tokens", "token_blocks", "usage_revenue_usd", "cumulative_usage_usd"],
    filters: [
      { field: "prompts", label: "Prompts", kind: "numberRange", placeholder: "min / max" },
      { field: "usage_revenue_usd", label: "Usage revenue USD", kind: "numberRange", placeholder: "min / max" },
    ],
    computed: [
      { id: "revenue_per_prompt", label: "Revenue / prompt", group: "Derived", deps: ["prompts", "usage_revenue_usd"], compute: (row) => { const p = Number(row.prompts); return p > 0 ? Math.round((Number(row.usage_revenue_usd) / p) * 10000) / 10000 : 0; } },
      { id: "tokens_per_prompt", label: "Tokens / prompt", group: "Derived", deps: ["prompts", "tokens"], compute: (row) => { const p = Number(row.prompts); return p > 0 ? Math.round((Number(row.tokens) / p) * 100) / 100 : 0; } },
    ],
  },
  {
    id: "customerSummary",
    label: "Customer/account summary",
    description: "Per-account status, plan, usage, and recurring vs usage revenue for every Group 6 account.",
    fields: [
      { id: "account_id", label: "Account ID", group: "Account" },
      { id: "login", label: "Login", group: "Account" },
      { id: "account_status", label: "Account status", group: "Account" },
      { id: "service_status", label: "Service status", group: "Account" },
      { id: "state", label: "State/region", group: "Account" },
      { id: "product", label: "Product", group: "Plan" },
      { id: "plan", label: "Plan", group: "Plan" },
      { id: "model", label: "Model", group: "Plan" },
      { id: "billing_kind", label: "Billing kind", group: "Plan" },
      { id: "prompts", label: "Prompts", group: "Usage" },
      { id: "token_blocks", label: "Token blocks", group: "Usage" },
      { id: "usage_revenue_usd", label: "Usage revenue USD", group: "Revenue" },
      { id: "recurring_revenue_usd", label: "Recurring revenue USD", group: "Revenue" },
      { id: "unassigned_revenue_usd", label: "Unassigned GL USD", group: "Revenue" },
      { id: "billed_due_usd", label: "Billed due USD", group: "AR" },
      { id: "received_usd", label: "Received USD", group: "AR" },
      { id: "outstanding_usd", label: "Outstanding USD", group: "AR" },
    ],
    defaultFields: ["account_id", "login", "account_status", "product", "plan", "model", "billing_kind", "prompts", "token_blocks", "usage_revenue_usd", "recurring_revenue_usd", "billed_due_usd", "outstanding_usd"],
    filters: [
      { field: "account_id", label: "Account ID", kind: "id", placeholder: "Exact ID" },
      { field: "login", label: "Login", kind: "text", placeholder: "Contains" },
      { field: "account_status", label: "Account status", kind: "enum", options: ["Active", "Inactive", "Closed"] },
      { field: "model", label: "Model", kind: "enum", options: ["3.0", "3.5"] },
      { field: "billing_kind", label: "Billing kind", kind: "enum", options: ["Unlimited", "PAYG", "Monthly", "Other"] },
      { field: "state", label: "State/region", kind: "text", placeholder: "Contains" },
      { field: "product", label: "Product", kind: "text", placeholder: "Contains" },
      { field: "plan", label: "Plan", kind: "text", placeholder: "Contains" },
      { field: "outstanding_usd", label: "Outstanding USD", kind: "numberRange", placeholder: "min / max" },
      { field: "usage_revenue_usd", label: "Usage revenue USD", kind: "numberRange", placeholder: "min / max" },
    ],
    computed: [
      { id: "total_revenue_usd", label: "Total revenue USD", group: "Derived", deps: ["usage_revenue_usd", "recurring_revenue_usd"], compute: (row) => Math.round((Number(row.usage_revenue_usd || 0) + Number(row.recurring_revenue_usd || 0) + Number(row.unassigned_revenue_usd || 0)) * 100) / 100 },
      { id: "collection_rate_pct", label: "Collection %", group: "Derived", deps: ["billed_due_usd"], compute: (row) => { const billed = Number(row.billed_due_usd); return billed > 0 ? Math.round((Number(row.received_usd) / billed) * 1000) / 10 : 0; } },
      { id: "tokens_per_prompt", label: "Tokens / prompt", group: "Derived", deps: ["prompts", "token_blocks"], compute: (row) => { const p = Number(row.prompts); return p > 0 ? Math.round(((Number(row.token_blocks) * 1000) / p) * 100) / 100 : 0; } },
    ],
  },
  {
    id: "revenueByGl",
    label: "Revenue by GL ID",
    description: "USD revenue split by BRM general-ledger account: recurring vs usage vs unassigned.",
    fields: [
      { id: "gl_id", label: "GL ID", group: "GL" },
      { id: "gl_account", label: "GL account", group: "GL" },
      { id: "revenue_type", label: "Revenue type", group: "GL" },
      { id: "usage_revenue_usd", label: "Revenue USD", group: "Finance" },
      { id: "share_pct", label: "Share %", group: "Finance" },
      { id: "impacts", label: "Impacts", group: "Finance" },
    ],
    defaultFields: ["gl_id", "gl_account", "revenue_type", "usage_revenue_usd", "share_pct", "impacts"],
    filters: [
      { field: "revenue_type", label: "Revenue type", kind: "enum", options: ["recurring", "usage", "unassigned", "other"] },
      { field: "gl_id", label: "GL ID", kind: "id", placeholder: "Exact GL" },
    ],
  },
  {
    id: "revenueTaxAr",
    label: "Revenue, tax, and AR",
    description: "Finance-facing totals for usage revenue, billed amounts, tax, and receivables.",
    fields: [
      { id: "category", label: "Category", group: "Finance" },
      { id: "metric", label: "Metric", group: "Finance" },
      { id: "value", label: "Value", group: "Finance" },
      { id: "unit", label: "Unit", group: "Finance" },
      { id: "detail", label: "Detail", group: "Notes" },
    ],
    defaultFields: ["category", "metric", "value", "unit", "detail"],
    filters: [
      { field: "category", label: "Category", kind: "enum", options: ["Revenue", "Tax", "AR"] },
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    description: "Catalog and realized-rate evidence by product and charge unit.",
    fields: [
      { id: "product", label: "Product", group: "Catalog" },
      { id: "unit", label: "Unit", group: "Catalog" },
      { id: "list_price", label: "List price", group: "Catalog" },
      { id: "realized_price", label: "Realized price", group: "Revenue" },
      { id: "usage_revenue_usd", label: "Usage revenue USD", group: "Revenue" },
    ],
    defaultFields: ["product", "unit", "list_price", "realized_price", "usage_revenue_usd"],
    filters: [
      { field: "product", label: "Product", kind: "text", placeholder: "Contains" },
      { field: "unit", label: "Unit", kind: "enum", options: ["prompt", "1k-token block"] },
    ],
  },
  {
    id: "dataQuality",
    label: "Data quality/exceptions",
    description: "Operational checks for inactive accounts, unrated usage, orphan events, and tax gaps.",
    fields: [
      { id: "check", label: "Check", group: "Quality" },
      { id: "value", label: "Value", group: "Quality" },
      { id: "severity", label: "Severity", group: "Quality" },
      { id: "detail", label: "Detail", group: "Notes" },
    ],
    defaultFields: ["check", "value", "severity", "detail"],
    filters: [
      { field: "severity", label: "Severity", kind: "enum", options: ["ok", "warning", "critical"] },
    ],
  },
  {
    id: "glLookup",
    label: "GL ID lookup",
    description: "Event-level USD balance impacts with GL ID, event type, and recurring/usage classification.",
    fields: [
      { id: "gl_id", label: "GL ID", group: "GL" },
      { id: "revenue_type", label: "Revenue type", group: "GL" },
      { id: "event_type", label: "Event type", group: "BRM" },
      { id: "event_id", label: "Event ID", group: "BRM" },
      { id: "account_id", label: "Account ID", group: "BRM" },
      { id: "resource_id", label: "Resource ID", group: "BRM" },
      { id: "amount", label: "Amount", group: "Finance" },
      { id: "event_date", label: "Event date", group: "Time" },
    ],
    defaultFields: ["gl_id", "revenue_type", "event_type", "event_id", "account_id", "amount", "event_date"],
    filters: [
      { field: "account_id", label: "Account ID", kind: "id", placeholder: "Exact ID" },
      { field: "gl_id", label: "GL ID", kind: "id", placeholder: "Exact GL" },
      { field: "revenue_type", label: "Revenue type", kind: "enum", options: ["recurring", "usage", "unassigned", "other"] },
      { field: "event_type", label: "Event type", kind: "text", placeholder: "Contains" },
      { field: "amount", label: "Amount", kind: "numberRange", placeholder: "min / max" },
    ],
  },
];

export function getReportDefinition(reportType: string) {
  return REPORT_DEFINITIONS.find((definition) => definition.id === reportType);
}

// Base fields plus any opt-in computed fields, for UI listing and validation.
export function reportFields(reportType: string): ReportField[] {
  const definition = getReportDefinition(reportType);
  if (!definition) return [];
  return [...definition.fields, ...(definition.computed ?? [])];
}

export function allowedFieldIds(reportType: string) {
  return new Set(reportFields(reportType).map((field) => field.id));
}

// Add computed columns to every row (cheap; projection later drops unused ones).
export function computeRows(reportType: string, rows: ReportRow[]): ReportRow[] {
  const computed = getReportDefinition(reportType)?.computed ?? [];
  if (!computed.length) return rows;
  return rows.map((row) => {
    const next: ReportRow = { ...row };
    for (const field of computed) {
      const ready = field.deps.every((dep) => row[dep] !== undefined && row[dep] !== null && row[dep] !== "");
      next[field.id] = ready ? field.compute(row) : "";
    }
    return next;
  });
}

function matchFilter(cell: string | number | null | undefined, filter: ReportFilter, value: FilterValue): boolean {
  if (filter.kind === "numberRange") {
    const range = value && typeof value === "object" ? value : {};
    const num = Number(cell);
    const hasNum = Number.isFinite(num);
    const min = range.min?.trim() ? Number(range.min) : null;
    const max = range.max?.trim() ? Number(range.max) : null;
    if (!hasNum) return min === null && max === null;
    if (min !== null && Number.isFinite(min) && num < min) return false;
    if (max !== null && Number.isFinite(max) && num > max) return false;
    return true;
  }
  const text = String(value ?? "").trim();
  if (!text) return true;
  const cellText = String(cell ?? "");
  if (filter.kind === "id") return cellText === text;
  if (filter.kind === "enum") return cellText.toLowerCase() === text.toLowerCase();
  return cellText.toLowerCase().includes(text.toLowerCase());
}

function isFilterActive(value: FilterValue | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  return Boolean(value.min?.trim() || value.max?.trim());
}

// Apply the report's declared filters to already-built (and computed) rows.
export function applyReportFilters(
  reportType: string,
  rows: ReportRow[],
  filters: Record<string, FilterValue> = {},
): ReportRow[] {
  const declared = getReportDefinition(reportType)?.filters ?? [];
  const active = declared.filter((filter) => isFilterActive(filters[filter.field]));
  if (!active.length) return rows;
  return rows.filter((row) => active.every((filter) => matchFilter(row[filter.field], filter, filters[filter.field])));
}

export function sortRows(reportType: string, rows: ReportRow[], sort?: ReportSort | null): ReportRow[] {
  if (!sort || !sort.field || !allowedFieldIds(reportType).has(sort.field)) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort.field];
    const bv = b[sort.field];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
}

export function clampLimit(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), MAX_REPORT_ROWS);
}

export function selectedFields(reportType: string, requested: unknown) {
  const definition = getReportDefinition(reportType);
  if (!definition) return [];

  const allowed = allowedFieldIds(reportType);
  const requestedFields = Array.isArray(requested) ? requested.map(String).filter((field) => allowed.has(field)) : [];
  return requestedFields.length ? requestedFields : definition.defaultFields;
}

export function projectRows(rows: ReportRow[], fields: string[]) {
  return rows.map((row) =>
    fields.reduce<ReportRow>((acc, field) => {
      acc[field] = row[field] ?? "";
      return acc;
    }, {}),
  );
}

export function reportFilename(reportType: ReportType, generatedAt = new Date()) {
  const stamp = generatedAt.toISOString().slice(0, 10);
  return `nextai-group6-${reportType.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}-${stamp}.csv`;
}

export function buildReportRows(reportType: ReportType, usage: Group6Usage, _dash: Group6Dashboard): ReportRow[] {
  if (reportType === "dailyUsage") {
    let cumulative = 0;
    return usage.daily.map((day) => {
      cumulative = Math.round((cumulative + day.revenue) * 100) / 100;
      return {
        date: day.date,
        prompts: day.prompts,
        tokens: day.tokens,
        token_blocks: Math.round((day.tokens / 1000) * 100) / 100,
        usage_revenue_usd: Number(day.revenue.toFixed(2)),
        cumulative_usage_usd: cumulative,
      };
    });
  }

  if (reportType === "customerSummary") {
    return usage.accounts.map((row) => ({
      account_id: row.acct,
      login: row.login,
      account_status: row.accountStatus,
      service_status: row.serviceStatus,
      state: row.state,
      product: row.product,
      plan: row.plan,
      model: row.modelLabel || row.model,
      billing_kind: row.kind,
      prompts: row.prompts,
      token_blocks: row.tokenBlocks,
      usage_revenue_usd: Number(row.usageRevenue.toFixed(2)),
      recurring_revenue_usd: Number(row.recurringRevenue.toFixed(2)),
      unassigned_revenue_usd: Number(row.unassignedRevenue.toFixed(2)),
      billed_due_usd: Number(row.billedDue.toFixed(2)),
      received_usd: Number(row.received.toFixed(2)),
      outstanding_usd: Number(row.outstanding.toFixed(2)),
    }));
  }

  if (reportType === "revenueByGl") {
    return usage.revenueByGl.map((row) => ({
      gl_id: row.glId,
      gl_account: row.label,
      revenue_type: row.kind,
      usage_revenue_usd: Number(row.usd.toFixed(2)),
      share_pct: row.pct,
      impacts: row.impacts,
    }));
  }

  if (reportType === "revenueTaxAr") {
    const ar = usage.ar;
    const tax = usage.tax;
    const split = usage.revenueSplit;
    return [
      { category: "Revenue", metric: "Recurring revenue", value: Number(split.recurring.toFixed(2)), unit: "USD", detail: "Subscription fees on GL 102" },
      { category: "Revenue", metric: "Usage revenue", value: Number(split.usage.toFixed(2)), unit: "USD", detail: "Consumption charges on GL 104" },
      { category: "Revenue", metric: "Unassigned GL revenue", value: Number(split.unassigned.toFixed(2)), unit: "USD", detail: "USD posted to GL 0 (needs a GL account)" },
      { category: "Revenue", metric: "Total billed revenue", value: Number(split.total.toFixed(2)), unit: "USD", detail: "Recurring + usage + unassigned (GL-classified)" },
      { category: "Revenue", metric: "Rated usage events", value: Number(usage.kpis.usageRevenue.toFixed(2)), unit: "USD", detail: "Usage-event impacts only (for reconciliation)" },
      { category: "Revenue", metric: "Total revenue due", value: Number(usage.kpis.revenueDue.toFixed(2)), unit: "USD", detail: "Bill total due (BILL_T)" },
      { category: "Tax", metric: "AIT taxable base", value: Number(tax.taxableBase.toFixed(2)), unit: "USD", detail: "Charges tagged for AIT" },
      { category: "Tax", metric: "AIT collected", value: Number(tax.collected.toFixed(2)), unit: "USD", detail: `${tax.ratePct}% configured rate` },
      { category: "Tax", metric: "Expected AIT", value: Number(tax.expected.toFixed(2)), unit: "USD", detail: "Taxable base multiplied by configured rate" },
      { category: "AR", metric: "Billed", value: Number(ar.billed.toFixed(2)), unit: "USD", detail: "Total due" },
      { category: "AR", metric: "Collected", value: Number(ar.received.toFixed(2)), unit: "USD", detail: "Received amount" },
      { category: "AR", metric: "Outstanding", value: Number(ar.outstanding.toFixed(2)), unit: "USD", detail: "Billed minus collected" },
      { category: "AR", metric: "Disputed", value: Number(ar.disputed.toFixed(2)), unit: "USD", detail: "Flagged on bills" },
    ];
  }

  if (reportType === "pricing") {
    return usage.pricing.map((row) => ({
      product: row.product,
      unit: row.unit,
      list_price: row.listPrice,
      realized_price: row.realizedPrice ? Number(row.realizedPrice.toFixed(4)) : "",
      usage_revenue_usd: Number(row.revenue.toFixed(2)),
    }));
  }

  if (reportType === "dataQuality") {
    const exceptions = usage.exceptions;
    const tax = usage.tax;
    const inactiveAccounts = usage.statusBreakdown.inactive + usage.statusBreakdown.closed;
    const unassignedGl = usage.revenueSplit.unassigned;
    return [
      { check: "Inactive or closed accounts", value: inactiveAccounts, severity: inactiveAccounts ? "warning" : "ok", detail: "Accounts not in active status" },
      { check: "Suspended subscriptions", value: exceptions.suspendedSubs, severity: exceptions.suspendedSubs ? "warning" : "ok", detail: "Purchased products not active" },
      { check: "Unrated usage", value: exceptions.unratedUsage, severity: exceptions.unratedUsage ? "warning" : "ok", detail: "Usage events with no rated charge" },
      { check: "Orphan usage", value: exceptions.orphanUsage, severity: exceptions.orphanUsage ? "critical" : "ok", detail: "Usage events with no valid account" },
      { check: "Unpaid bills", value: exceptions.failedTxns, severity: exceptions.failedTxns ? "warning" : "ok", detail: "Bills where received is less than total due" },
      { check: "Revenue on unassigned GL", value: Number(unassignedGl.toFixed(2)), severity: unassignedGl ? "warning" : "ok", detail: "USD posted to GL 0 — map to a GL account for clean recurring/usage reporting" },
      { check: "AIT not collected", value: Number(Math.max(tax.expected - tax.collected, 0).toFixed(2)), severity: tax.expected > tax.collected ? "warning" : "ok", detail: "Expected tax minus collected tax" },
    ];
  }

  return [];
}