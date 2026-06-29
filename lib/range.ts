// Billing-period range helpers (shared by the API route, server pages, and the
// client date picker). Dates are 'YYYY-MM-DD'; epochs are Unix seconds (UTC).

export type DateRange = { from?: number; to?: number };

function dayToEpoch(date: string, endOfDay = false): number | undefined {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return Math.floor(ms / 1000);
}

// Accepts 'YYYY-MM-DD' or raw epoch-second strings.
export function parseRange(from: string | null, to: string | null): DateRange {
  const r: DateRange = {};
  if (from) r.from = /^\d{4}-/.test(from) ? dayToEpoch(from, false) : Number(from) || undefined;
  if (to) r.to = /^\d{4}-/.test(to) ? dayToEpoch(to, true) : Number(to) || undefined;
  if (r.from != null && r.to != null && r.from > r.to) {
    const originalFrom = r.from;
    r.from = /^\d{4}-/.test(to ?? "") ? dayToEpoch(to as string, false) : r.to;
    r.to = /^\d{4}-/.test(from ?? "") ? dayToEpoch(from as string, true) : originalFrom;
  }
  return r;
}

export function epochToDay(epoch?: number): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

// Presets computed against the data's available [min,max] day strings.
export function presetRange(preset: string, min: string, max: string): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (!max) return {};
  const maxD = new Date(`${max}T00:00:00Z`);
  if (preset === "this") {
    const y = maxD.getUTCFullYear();
    const m = maxD.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return { from, to: max };
  }
  if (preset === "last") {
    const y = maxD.getUTCFullYear();
    const m = maxD.getUTCMonth();
    const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: from < min ? min : from, to };
  }
  return {};
}
