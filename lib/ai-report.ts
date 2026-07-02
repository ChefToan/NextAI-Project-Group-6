import "server-only";
import {
  CATALOG_DIMENSIONS,
  CATALOG_MEASURES,
  MEASURE_FILTER_OPS,
  getDimension,
  getMeasure,
  type CatalogDimension,
  type FilterOp,
} from "@/lib/metrics-catalog";
import { anyProviderConfigured, callAiJson, parseJsonBlock } from "@/lib/ai-providers";
import type { CustomFilter, CustomSelection, CustomSort } from "@/lib/build-report-sql";

export type DraftResult = {
  selection?: CustomSelection;
  notes?: string;
  provider?: string;
  model?: string;
  error?: string;
  missing?: string[];
};

const ALL_OPS: FilterOp[] = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"];

function catalogPrompt(userPrompt: string): string {
  const dims = CATALOG_DIMENSIONS.map((d) => {
    const values = d.options ? `; values: ${d.options.join("|")}` : "";
    const aliases = d.valueAliases ? `; aliases: ${Object.entries(d.valueAliases).map(([alias, value]) => `${alias}=${value}`).join("|")}` : "";
    return `- ${d.id} (${d.label}, ${d.type}; ops: ${d.filterOps.join("/")}${values}${aliases})`;
  }).join("\n");
  const measures = CATALOG_MEASURES.map((m) => `- ${m.id} (${m.label})`).join("\n");

  return [
    "You translate a natural-language request into a JSON report selection for the NextAI Group 6 billing console.",
    "The report is a pivot over Group 6 usage events. Use ONLY the dimension and measure ids listed below. Never invent ids.",
    "Output STRICT JSON only — no markdown, no prose outside the JSON.",
    "",
    "Selection schema:",
    "{",
    '  "dimensions": string[],   // zero or more dimension ids to group by',
    '  "measures": string[],     // one or more measure ids to aggregate (required)',
    '  "filters": [ { "field": string, "op": string, "value": string | string[] } ],',
    '  "sort": { "field": string, "dir": "asc" | "desc" } | null,',
    '  "limit": number | null,',
    '  "notes": string           // one short sentence describing the report',
    "}",
    "If the request needs data not covered by these fields, return {\"error\":\"<reason>\",\"missing\":[\"<what>\"]} instead.",
    "",
    "Operators: eq, ne, gt, gte, lt, lte, contains, in. A dimension only allows its listed ops.",
    "Measures may be filtered only with eq/ne/gt/gte/lt/lte (applied as HAVING).",
    "The billing date range is applied automatically — do not add day/hour filters unless the user asks for a specific day or hour.",
    "",
    "Dimensions:",
    dims,
    "",
    "Measures:",
    measures,
    "",
    `Request: ${userPrompt}`,
  ].join("\n");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeDimensionValue(dimension: CatalogDimension, raw: string): string {
  const value = raw.trim();
  if (!dimension.valueAliases) return value;
  const direct = dimension.valueAliases[value];
  if (direct) return direct;
  const normalized = Object.entries(dimension.valueAliases).find(([alias]) => alias.toLowerCase() === value.toLowerCase());
  return normalized?.[1] ?? value;
}

function coerceFilter(raw: unknown): CustomFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const field = String(source.field ?? "");
  const op = String(source.op ?? "") as FilterOp;
  if (!ALL_OPS.includes(op)) return null;

  const dimension = getDimension(field);
  const measure = getMeasure(field);
  if (dimension) {
    if (!dimension.filterOps.includes(op)) return null;
  } else if (measure) {
    if (!MEASURE_FILTER_OPS.includes(op)) return null;
  } else {
    return null;
  }

  let value = Array.isArray(source.value)
    ? source.value.map((item) => String(item).trim()).filter(Boolean)
    : String(source.value ?? "").trim();
  if (!value || (Array.isArray(value) && value.length === 0)) return null;

  if (dimension) {
    value = Array.isArray(value)
      ? value.map((item) => normalizeDimensionValue(dimension, item))
      : normalizeDimensionValue(dimension, value);
  }

  return { field, op, value };
}

// Turn an arbitrary parsed model response into a safe CustomSelection, dropping
// anything not in the catalog. Returns an error if no valid measure survives.
export function validateSelection(parsed: unknown): DraftResult {
  if (!parsed || typeof parsed !== "object") {
    return { error: "The assistant did not return a report selection." };
  }
  const source = parsed as Record<string, unknown>;

  if (typeof source.error === "string" && source.error.trim()) {
    return { error: source.error.trim(), missing: asStringArray(source.missing) };
  }

  const dimensions = asStringArray(source.dimensions).filter((id) => getDimension(id));
  const measures = asStringArray(source.measures).filter((id) => getMeasure(id));
  if (!measures.length) {
    return { error: "The assistant did not choose a measure this dashboard supports. Try rephrasing." };
  }

  const columns = [...dimensions, ...measures];
  const filters = Array.isArray(source.filters)
    ? source.filters.map(coerceFilter).filter((f): f is CustomFilter => Boolean(f))
    : [];

  let sort: CustomSort | null = null;
  if (source.sort && typeof source.sort === "object") {
    const sortSource = source.sort as Record<string, unknown>;
    const field = String(sortSource.field ?? "");
    if (columns.includes(field)) {
      sort = { field, dir: sortSource.dir === "asc" ? "asc" : "desc" };
    }
  }

  const limitNum = Number(source.limit);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : undefined;

  const notes = typeof source.notes === "string" ? source.notes.trim() : undefined;
  return { selection: { dimensions, measures, filters, sort, limit }, notes };
}

// Ask the LLM to draft a report selection, then validate it against the catalog.
export async function draftReportSelection(prompt: string): Promise<DraftResult> {
  const clean = prompt.trim();
  if (!clean) return { error: "Describe the report you want." };
  if (!anyProviderConfigured()) {
    return { error: "No AI provider is configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY." };
  }

  let raw;
  try {
    raw = await callAiJson(catalogPrompt(clean));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The AI request failed." };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonBlock(raw.text);
  } catch {
    return { error: "The assistant did not return a valid report selection.", provider: raw.provider, model: raw.model };
  }

  const validated = validateSelection(parsed);
  return { ...validated, provider: raw.provider, model: raw.model };
}
