// Client-side report-section visibility preferences (persisted in localStorage)
// so users can show/hide dense report sections.
export type MetricGroup =
  | "tokenBreakdown"
  | "relationship"
  | "resourceAllocation"
  | "customers"
  | "dataQuality"
  | "tax"
  | "ar"
  | "pricing";

export const METRIC_GROUPS: { id: MetricGroup; label: string }[] = [
  { id: "tokenBreakdown", label: "Token breakdown" },
  { id: "relationship", label: "Relationship" },
  { id: "resourceAllocation", label: "Resource allocation" },
  { id: "customers", label: "Customers" },
  { id: "dataQuality", label: "Data quality & exceptions" },
  { id: "tax", label: "Tax - AIT" },
  { id: "ar", label: "Accounts receivable" },
  { id: "pricing", label: "Pricing" },
];

// Default report view keeps the operational sections visible and leaves deeper
// audit sections available from Customize.
const DEFAULT_ON: MetricGroup[] = ["tokenBreakdown", "relationship", "resourceAllocation", "customers"];
const KEY = "g6.metricPrefs.v2";
export const PREFS_EVENT = "g6:metricprefs";

export function defaultPrefs(): Record<MetricGroup, boolean> {
  return METRIC_GROUPS.reduce((acc, g) => {
    acc[g.id] = DEFAULT_ON.includes(g.id);
    return acc;
  }, {} as Record<MetricGroup, boolean>);
}

export function readPrefs(): Record<MetricGroup, boolean> {
  if (typeof window === "undefined") return defaultPrefs();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<Record<string, boolean>>;
    const prefs = defaultPrefs();
    for (const group of METRIC_GROUPS) {
      if (typeof parsed[group.id] === "boolean") prefs[group.id] = parsed[group.id] as boolean;
    }
    return prefs;
  } catch {
    return defaultPrefs();
  }
}

export function writePrefs(prefs: Record<MetricGroup, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  } catch {
    /* ignore */
  }
}

export function isDefaultOn(group: MetricGroup): boolean {
  return DEFAULT_ON.includes(group);
}
