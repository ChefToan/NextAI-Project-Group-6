// Shared number formatting (safe for server and client components).

export function compact(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(digits)}K`;
  return `${Math.round(n)}`;
}

export function intGroup(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function money(n: number, compactAbove = 100_000): string {
  if (Math.abs(n) >= compactAbove) return `$${compact(n)}`;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function money0(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}
