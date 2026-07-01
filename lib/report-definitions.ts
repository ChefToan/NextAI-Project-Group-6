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

export type ReportDefinition = {
  id: ReportType;
  label: string;
  description: string;
  fields: ReportField[];
  defaultFields: string[];
};

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
  },
];

export function getReportDefinition(reportType: string) {
  return REPORT_DEFINITIONS.find((definition) => definition.id === reportType);
}

export function allowedFieldIds(reportType: string) {
  return new Set(getReportDefinition(reportType)?.fields.map((field) => field.id) ?? []);
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