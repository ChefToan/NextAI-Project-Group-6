import "server-only";
import { runContextQuery } from "@/lib/oracle";

export type OracleMetric = {
  METRIC_NAME?: string;
  METRIC_VALUE?: string;
  metric_name?: string;
  metric_value?: string;
};

export type OracleDashboardSummary = {
  connected: boolean;
  generatedAt: string;
  metrics: Record<string, string>;
  highlights: string[];
  suggestedQuestion: string;
};

function metricMap(rows: OracleMetric[] = []) {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const name = row.METRIC_NAME ?? row.metric_name;
    const value = row.METRIC_VALUE ?? row.metric_value;
    if (name && value != null) acc[name] = String(value);
    return acc;
  }, {});
}

export async function getOracleDashboardSummary(): Promise<OracleDashboardSummary> {
  const result = await runContextQuery();
  const metrics = metricMap((result?.rows ?? []) as OracleMetric[]);

  const accountTotal = metrics.account_total ?? "unknown";
  const active = metrics.account_active_10100 ?? "unknown";
  const inactive = metrics.account_inactive_10102 ?? "unknown";
  const closed = metrics.account_closed_10103 ?? "unknown";
  const recent = metrics.account_created_last_7d_from_latest ?? "unknown";
  const billinfo = metrics.billinfo_total ?? "unknown";
  const services = metrics.service_total ?? "unknown";
  const events = metrics.event_total ?? "unknown";

  return {
    connected: Boolean(result),
    generatedAt: new Date().toISOString(),
    metrics,
    highlights: [
      `Oracle BRM schema ${metrics.oracle_schema ?? "unknown"} on service ${metrics.oracle_service ?? "unknown"}.`,
      `${accountTotal} accounts: ${active} active, ${inactive} inactive, ${closed} closed.`,
      `${recent} accounts were created in the 7-day window ending at the latest account timestamp (${metrics.latest_account_created_at_utc ?? "unknown UTC"}).`,
      `${billinfo} billinfos, ${services} services, and ${events} events are visible to this schema.`,
    ],
    suggestedQuestion:
      "How many active, inactive, and closed BRM accounts are in Oracle, and what changed in the latest 7-day window?",
  };
}
