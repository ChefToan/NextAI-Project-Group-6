"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REPORT_DEFINITIONS, type FilterValue, type ReportType } from "@/lib/report-definitions";
import {
  CATALOG_DIMENSIONS,
  CATALOG_MEASURES,
  FILTER_OP_LABELS,
  MEASURE_FILTER_OPS,
  catalogLabel,
  getDimension,
  getMeasure,
  type FilterOp,
} from "@/lib/metrics-catalog";

type ReportResult = {
  filename: string;
  columns: string[];
  columnLabels?: Record<string, string>;
  rows: Record<string, string | number | null>[];
  generatedAt: string;
  totalRows?: number;
  returnedRows?: number;
  unavailableReason?: string;
  error?: string;
};

type SortState = { field: string; dir: "asc" | "desc" };
type CustomFilterRow = { field: string; op: FilterOp; value: string };
type ScrollTarget = "preview" | "message";

type Props = {
  range?: { from?: number; to?: number; label?: string };
  label?: string;
};

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatCell(value: unknown, column: string) {
  if (value === null || value === undefined || value === "") return "—";
  // Identifiers are shown raw — thousands separators on IDs are misleading.
  if (/(^|_)id$/.test(column)) return String(value);
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(result: ReportResult) {
  const rows = [result.columns, ...result.rows.map((row) => result.columns.map((column) => row[column] ?? ""))];
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), result.filename);
}

function downloadJson(result: ReportResult) {
  const data = result.rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const column of result.columns) out[column] = row[column] ?? null;
    return out;
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  triggerDownload(blob, result.filename.replace(/\.csv$/, ".json"));
}

function fieldOperators(field: string): FilterOp[] {
  const dimension = getDimension(field);
  if (dimension) return dimension.filterOps;
  return getMeasure(field) ? MEASURE_FILTER_OPS : [];
}

export function GenerateReportButton({ range, label = "Generate report" }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [reportType, setReportType] = useState<ReportType>("dailyUsage");
  const [fields, setFields] = useState<string[]>(REPORT_DEFINITIONS[0].defaultFields);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [sort, setSort] = useState<SortState>({ field: "", dir: "desc" });
  const [limit, setLimit] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");

  // Custom-query state (catalog-driven engine).
  const [customDims, setCustomDims] = useState<string[]>(["model"]);
  const [customMeasures, setCustomMeasures] = useState<string[]>(["event_count", "usage_revenue"]);
  const [customFilters, setCustomFilters] = useState<CustomFilterRow[]>([]);
  const [customSort, setCustomSort] = useState<SortState>({ field: "", dir: "desc" });
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");
  const [glMeta, setGlMeta] = useState<{ loaded: boolean; available: boolean; reason?: string }>({ loaded: false, available: true });
  const [mounted, setMounted] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!scrollTarget) return;
    const id = window.setTimeout(() => {
      const target = scrollTarget === "preview" ? previewRef.current : messageRef.current;
      const container = mainRef.current;
      if (target && container) {
        const targetRect = target.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const top = targetRect.top - containerRect.top + container.scrollTop - 12;
        container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setScrollTarget(null);
    }, 80);
    return () => window.clearTimeout(id);
  }, [scrollTarget, result, error]);

  const definition = useMemo(
    () => REPORT_DEFINITIONS.find((candidate) => candidate.id === reportType) ?? REPORT_DEFINITIONS[0],
    [reportType],
  );

  const allFields = useMemo(
    () => [...definition.fields, ...(definition.computed ?? [])],
    [definition],
  );

  const presetLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of allFields) map[field.id] = field.label;
    return map;
  }, [allFields]);

  const PREVIEW_LIMIT = 50;

  useEffect(() => {
    setFields(definition.defaultFields);
    setFilters({});
    setSort({ field: "", dir: "desc" });
    setLimit("");
    setResult(null);
    setError("");
  }, [definition]);

  useEffect(() => {
    if (!open || glMeta.loaded) return;
    let active = true;
    fetch("/api/group6/report")
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setGlMeta({ loaded: true, available: Boolean(data.glAvailable), reason: data.glUnavailableReason });
      })
      .catch((caught) => {
        if (!active) return;
        setGlMeta({ loaded: true, available: false, reason: caught instanceof Error ? caught.message : "Unable to check GL metadata." });
      });
    return () => {
      active = false;
    };
  }, [open, glMeta.loaded]);

  function selectPreset(id: ReportType) {
    setMode("preset");
    setReportType(id);
  }

  function selectCustom() {
    setMode("custom");
    setResult(null);
    setError("");
  }

  function toggleField(field: string) {
    setFields((current) => {
      if (current.includes(field)) return current.length === 1 ? current : current.filter((candidate) => candidate !== field);
      return [...current, field];
    });
    setResult(null);
  }

  function setFilterValue(field: string, value: FilterValue) {
    setFilters((current) => ({ ...current, [field]: value }));
    setResult(null);
  }

  function setBound(field: string, bound: "min" | "max", value: string) {
    setFilters((current) => {
      const prev = (current[field] && typeof current[field] === "object" ? current[field] : {}) as { min?: string; max?: string };
      return { ...current, [field]: { ...prev, [bound]: value } };
    });
    setResult(null);
  }

  function stringValue(field: string) {
    const value = filters[field];
    return typeof value === "string" ? value : "";
  }

  function boundValue(field: string, bound: "min" | "max") {
    const value = filters[field];
    return value && typeof value === "object" ? value[bound] ?? "" : "";
  }

  function toggleCustom(list: string[], setList: (next: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((candidate) => candidate !== id) : [...list, id]);
    setResult(null);
  }

  function addCustomFilter() {
    const first = CATALOG_DIMENSIONS[0];
    setCustomFilters((current) => [...current, { field: first.id, op: first.filterOps[0], value: "" }]);
    setResult(null);
  }

  function updateCustomFilter(index: number, patch: Partial<CustomFilterRow>) {
    setCustomFilters((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setResult(null);
  }

  function removeCustomFilter(index: number) {
    setCustomFilters((current) => current.filter((_, i) => i !== index));
    setResult(null);
  }

  const customColumns = useMemo(() => [...customDims, ...customMeasures], [customDims, customMeasures]);

  async function postReport(body: object, options: { scrollToResult?: boolean } = {}) {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/group6/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ReportResult;
      if (!response.ok) throw new Error(data.error || "Unable to generate report.");
      setResult(data);
      if (options.scrollToResult) setScrollTarget(data.unavailableReason ? "message" : "preview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate report.");
      if (options.scrollToResult) setScrollTarget("message");
    } finally {
      setLoading(false);
    }
  }

  // Assemble the custom-mode request. Values are passed explicitly so the AI path
  // can preview a fresh draft before React state has flushed.
  function customBody(dims: string[], measures: string[], filterRows: CustomFilterRow[], sortState: SortState, limitStr: string) {
    const columns = [...dims, ...measures];
    return {
      mode: "custom" as const,
      range,
      selection: {
        dimensions: dims,
        measures,
        filters: filterRows
          .filter((row) => row.field && String(row.value).trim() !== "")
          .map((row) => ({
            field: row.field,
            op: row.op,
            value: row.op === "in" ? row.value.split(",").map((part) => part.trim()).filter(Boolean) : row.value,
          })),
        sort: sortState.field && columns.includes(sortState.field) ? sortState : undefined,
        limit: limitStr ? Number(limitStr) : undefined,
      },
    };
  }

  async function generate() {
    if (mode === "custom") {
      await postReport(customBody(customDims, customMeasures, customFilters, customSort, limit), { scrollToResult: true });
      return;
    }
    await postReport({
      reportType,
      fields,
      range,
      filters,
      sort: sort.field && fields.includes(sort.field) ? sort : undefined,
      limit: limit ? Number(limit) : undefined,
    }, { scrollToResult: true });
  }

  // AI drafts a catalog selection; we fill the controls and auto-preview it.
  async function runAiDraft() {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setError("Describe the report you want.");
      setScrollTarget("message");
      return;
    }
    setAiLoading(true);
    setError("");
    setAiNote("");
    try {
      const response = await fetch("/api/group6/report/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok || !data.selection) {
        const missing = Array.isArray(data.missing) && data.missing.length ? ` (missing: ${data.missing.join(", ")})` : "";
        throw new Error((data.error || "Could not draft a report from that request.") + missing);
      }
      const selection = data.selection as {
        dimensions?: string[];
        measures?: string[];
        filters?: { field: string; op: FilterOp; value: string | string[] }[];
        sort?: SortState | null;
        limit?: number;
      };
      const dims = selection.dimensions ?? [];
      const measures = selection.measures ?? [];
      const filterRows: CustomFilterRow[] = (selection.filters ?? []).map((f) => ({
        field: f.field,
        op: f.op,
        value: Array.isArray(f.value) ? f.value.join(", ") : String(f.value),
      }));
      const sortState: SortState =
        selection.sort && selection.sort.field
          ? { field: selection.sort.field, dir: selection.sort.dir === "asc" ? "asc" : "desc" }
          : { field: "", dir: "desc" };
      const limitStr = selection.limit ? String(selection.limit) : limit;

      setCustomDims(dims);
      setCustomMeasures(measures);
      setCustomFilters(filterRows);
      setCustomSort(sortState);
      if (selection.limit) setLimit(limitStr);
      setAiNote(`${data.notes ? `${data.notes} ` : ""}· drafted by ${data.provider ?? "AI"}`);

      await postReport(customBody(dims, measures, filterRows, sortState, limitStr), { scrollToResult: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not draft a report.");
      setScrollTarget("message");
    } finally {
      setAiLoading(false);
    }
  }

  const filterDefs = definition.filters ?? [];
  const labelMap = result?.columnLabels ?? presetLabels;
  const sortColumns = mode === "custom" ? customColumns : fields;
  const limited = result && typeof result.totalRows === "number" && result.totalRows > result.rows.length;

  return (
    <>
      <button type="button" className="btn btn-primary" data-testid="report-open-button" onClick={() => setOpen(true)}>
        <span className="ms">fact_check</span>
        {label}
      </button>

      {open && mounted
        ? createPortal(
        <div className="report-modal-backdrop" role="presentation" data-testid="report-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-builder-title" data-testid="report-builder-modal">
            <div className="report-modal-head">
              <div>
                <div className="eyebrow">Report builder</div>
                <h2 id="report-builder-title">Generate report</h2>
                <p>Pick a preset or build a custom query, filter and sort, preview, then download CSV or JSON.</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Close report builder" data-testid="report-close-button" onClick={() => setOpen(false)}>
                <span className="ms">close</span>
              </button>
            </div>

            <div className="report-builder-grid">
              <aside className="report-preset-list" aria-label="Report presets">
                <button
                  type="button"
                  className={`report-preset ${mode === "custom" ? "is-active" : ""}`}
                  data-testid="report-mode-custom"
                  onClick={selectCustom}
                >
                  <span>Custom query</span>
                  <small>Build a pivot from any dimensions and measures.</small>
                </button>
                {REPORT_DEFINITIONS.map((preset) => {
                  const disabled = preset.id === "glLookup" && glMeta.loaded && !glMeta.available;
                  const active = mode === "preset" && preset.id === reportType;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      className={`report-preset ${active ? "is-active" : ""}`}
                      data-testid={`report-preset-${preset.id}`}
                      disabled={disabled}
                      onClick={() => selectPreset(preset.id)}
                    >
                      <span>{preset.label}</span>
                      <small>{disabled ? glMeta.reason : preset.description}</small>
                    </button>
                  );
                })}
              </aside>

              <div className="report-builder-main" ref={mainRef}>
                {mode === "custom" ? (
                  <>
                    <div className="report-card report-ai-card">
                      <div className="report-card-head">
                        <div>
                          <h3>Ask AI</h3>
                          <p>Describe the report in plain English — AI drafts the query below for you to review and run.</p>
                        </div>
                      </div>
                      <div className="report-ai-row">
                        <input
                          value={aiPrompt}
                          data-testid="report-ai-prompt"
                          placeholder="e.g. usage revenue by model, top 5 accounts by tokens"
                          onChange={(event) => setAiPrompt(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") runAiDraft(); }}
                        />
                        <button type="button" className="btn btn-primary" data-testid="report-ai-draft-button" onClick={runAiDraft} disabled={aiLoading}>
                          <span className="ms">auto_awesome</span>
                          {aiLoading ? "Drafting..." : "Draft with AI"}
                        </button>
                      </div>
                      {aiNote ? <p className="report-hint">{aiNote}</p> : null}
                    </div>

                    <div className="report-card">
                      <div className="report-card-head">
                        <div>
                          <h3>Dimensions</h3>
                          <p>Group rows by these attributes (optional — omit for a grand total).</p>
                        </div>
                        <span className="pill">{customDims.length} selected</span>
                      </div>
                      <div className="report-field-grid">
                        {CATALOG_DIMENSIONS.map((dimension) => (
                          <label className="report-field" key={dimension.id}>
                            <input type="checkbox" data-testid={`report-custom-dimension-${dimension.id}`} checked={customDims.includes(dimension.id)} onChange={() => toggleCustom(customDims, setCustomDims, dimension.id)} />
                            <span>
                              <strong>{dimension.label}</strong>
                              <small>{dimension.group}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="report-card">
                      <div className="report-card-head">
                        <div>
                          <h3>Measures</h3>
                          <p>Aggregate values to compute. Pick at least one.</p>
                        </div>
                        <span className="pill">{customMeasures.length} selected</span>
                      </div>
                      <div className="report-field-grid">
                        {CATALOG_MEASURES.map((measure) => (
                          <label className="report-field" key={measure.id}>
                            <input type="checkbox" data-testid={`report-custom-measure-${measure.id}`} checked={customMeasures.includes(measure.id)} onChange={() => toggleCustom(customMeasures, setCustomMeasures, measure.id)} />
                            <span>
                              <strong>{measure.label}</strong>
                              <small>{measure.group}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="report-card">
                      <div className="report-card-head">
                        <div>
                          <h3>Filters</h3>
                          <p>Rows must match every filter. The report date range applies automatically.</p>
                        </div>
                        <button type="button" className="btn btn-sm" data-testid="report-add-filter-button" onClick={addCustomFilter}>
                          <span className="ms">add</span>Add filter
                        </button>
                      </div>
                      {customFilters.length === 0 ? (
                        <p className="report-hint">No filters — the whole date range is included.</p>
                      ) : (
                        <div className="report-custom-filters">
                          {customFilters.map((row, index) => {
                            const dimension = getDimension(row.field);
                            const ops = fieldOperators(row.field);
                            return (
                              <div className="report-filter-row" data-testid="report-custom-filter-row" key={index}>
                                <select
                                  value={row.field}
                                  data-testid={`report-custom-filter-field-${index}`}
                                  onChange={(event) => {
                                    const nextField = event.target.value;
                                    updateCustomFilter(index, { field: nextField, op: fieldOperators(nextField)[0], value: "" });
                                  }}
                                >
                                  <optgroup label="Dimensions">
                                    {CATALOG_DIMENSIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                                  </optgroup>
                                  <optgroup label="Measures">
                                    {CATALOG_MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                                  </optgroup>
                                </select>
                                <select data-testid={`report-custom-filter-op-${index}`} value={row.op} onChange={(event) => updateCustomFilter(index, { op: event.target.value as FilterOp })}>
                                  {ops.map((op) => <option key={op} value={op}>{FILTER_OP_LABELS[op]}</option>)}
                                </select>
                                {dimension?.options && row.op !== "contains" ? (
                                  <select data-testid={`report-custom-filter-value-${index}`} value={row.value} onChange={(event) => updateCustomFilter(index, { value: event.target.value })}>
                                    <option value="">value…</option>
                                    {dimension.options.map((option) => <option key={option} value={option}>{option}</option>)}
                                  </select>
                                ) : (
                                  <input data-testid={`report-custom-filter-value-${index}`} value={row.value} placeholder={row.op === "in" ? "a, b, c" : "value"} onChange={(event) => updateCustomFilter(index, { value: event.target.value })} />
                                )}
                                <button type="button" className="icon-btn" aria-label="Remove filter" data-testid={`report-remove-filter-${index}`} onClick={() => removeCustomFilter(index)}>
                                  <span className="ms">close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="report-card">
                      <div className="report-card-head">
                        <div>
                          <h3>{definition.label}</h3>
                          <p>{definition.description}</p>
                        </div>
                        <span className="pill">{fields.length} fields</span>
                      </div>
                      <div className="report-field-grid">
                        {allFields.map((field) => (
                          <label className="report-field" key={field.id}>
                            <input type="checkbox" data-testid={`report-field-${field.id}`} checked={fields.includes(field.id)} onChange={() => toggleField(field.id)} />
                            <span>
                              <strong>{field.label}</strong>
                              <small>{field.group}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {filterDefs.length ? (
                      <div className="report-card">
                        <div className="report-card-head">
                          <div>
                            <h3>Filters</h3>
                            <p>The current report date range is applied automatically.</p>
                          </div>
                          <span className="pill">{range?.label ?? "Current range"}</span>
                        </div>
                        <div className="report-filter-grid">
                          {filterDefs.map((filter) => (
                            <label key={filter.field}>
                              <span>{filter.label}</span>
                              {filter.kind === "enum" ? (
                                <select data-testid={`report-filter-${filter.field}`} value={stringValue(filter.field)} onChange={(event) => setFilterValue(filter.field, event.target.value)}>
                                  <option value="">Any</option>
                                  {filter.options?.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                </select>
                              ) : filter.kind === "numberRange" ? (
                                <span className="report-range-inputs">
                                  <input type="number" data-testid={`report-filter-${filter.field}-min`} placeholder="min" value={boundValue(filter.field, "min")} onChange={(event) => setBound(filter.field, "min", event.target.value)} />
                                  <input type="number" data-testid={`report-filter-${filter.field}-max`} placeholder="max" value={boundValue(filter.field, "max")} onChange={(event) => setBound(filter.field, "max", event.target.value)} />
                                </span>
                              ) : (
                                <input data-testid={`report-filter-${filter.field}`} value={stringValue(filter.field)} onChange={(event) => setFilterValue(filter.field, event.target.value)} placeholder={filter.placeholder ?? "Optional"} />
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                <div className="report-card">
                  <div className="report-card-head">
                    <div>
                      <h3>Sort &amp; output</h3>
                      <p>Order the rows, cap the row count, and pick a download format.</p>
                    </div>
                  </div>
                  <div className="report-filter-grid">
                    <label>
                      <span>Sort by</span>
                      <select
                        value={mode === "custom" ? customSort.field : sort.field}
                        data-testid="report-sort-field"
                        onChange={(event) => {
                          const field = event.target.value;
                          if (mode === "custom") setCustomSort((current) => ({ ...current, field }));
                          else setSort((current) => ({ ...current, field }));
                          setResult(null);
                        }}
                      >
                        <option value="">Default order</option>
                        {sortColumns.map((field) => (
                          <option key={field} value={field}>{labelMap[field] ?? catalogLabel(field)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Direction</span>
                      <select
                        value={mode === "custom" ? customSort.dir : sort.dir}
                        data-testid="report-sort-direction"
                        disabled={mode === "custom" ? !customSort.field : !sort.field}
                        onChange={(event) => {
                          const dir = event.target.value === "asc" ? "asc" : "desc";
                          if (mode === "custom") setCustomSort((current) => ({ ...current, dir }));
                          else setSort((current) => ({ ...current, dir }));
                          setResult(null);
                        }}
                      >
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                      </select>
                    </label>
                    <label>
                      <span>Row limit</span>
                      <input type="number" min={1} data-testid="report-row-limit" placeholder="All rows" value={limit} onChange={(event) => { setLimit(event.target.value); setResult(null); }} />
                    </label>
                    <label>
                      <span>Format</span>
                      <select data-testid="report-format" value={format} onChange={(event) => setFormat(event.target.value === "json" ? "json" : "csv")}>
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                      </select>
                    </label>
                  </div>
                </div>

                {error ? <div className="report-error" data-testid="report-error" ref={messageRef}>{error}</div> : null}
                {result?.unavailableReason ? <div className="report-error" data-testid="report-unavailable" ref={messageRef}>{result.unavailableReason}</div> : null}

                {result && !result.unavailableReason ? (
                  <div className="report-card report-preview-card" data-testid="report-preview" ref={previewRef}>
                    <div className="report-card-head">
                      <div>
                        <h3>Preview</h3>
                        <p>
                          {result.rows.length.toLocaleString()} rows · {result.columns.length} fields ·{" "}
                          <span className="mono">{result.filename}</span>
                          {limited ? <> · {result.totalRows?.toLocaleString()} before limit</> : null}
                        </p>
                      </div>
                      {result.rows.length > PREVIEW_LIMIT ? (
                        <span className="pill">first {PREVIEW_LIMIT}</span>
                      ) : null}
                    </div>
                    {result.rows.length === 0 ? (
                      <div className="report-preview-empty">No rows matched this report and filter set.</div>
                    ) : (
                      <div className="report-preview-scroll">
                        <table className="report-preview-table" data-testid="report-preview-table">
                          <thead>
                            <tr>
                              {result.columns.map((column) => (
                                <th key={column} scope="col">{labelMap[column] ?? column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.slice(0, PREVIEW_LIMIT).map((row, index) => (
                              <tr key={index}>
                                {result.columns.map((column) => (
                                  <td key={column}>{formatCell(row[column], column)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}

              </div>
            </div>

            <div className="report-modal-footer">
              {result && !result.unavailableReason ? (
                <span className="report-footer-status">
                  {result.rows.length.toLocaleString()} rows ready
                </span>
              ) : null}
              <div className="report-modal-actions">
                <button type="button" className="btn" data-testid="report-preview-button" onClick={generate} disabled={loading}>
                  <span className="ms">preview</span>
                  {loading ? "Generating..." : "Preview report"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="report-download-button"
                  disabled={!result || Boolean(result.unavailableReason) || result.rows.length === 0}
                  onClick={() => result && (format === "json" ? downloadJson(result) : downloadCsv(result))}
                >
                  <span className="ms">download</span>
                  Download {format.toUpperCase()}
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )
        : null}
    </>
  );
}
