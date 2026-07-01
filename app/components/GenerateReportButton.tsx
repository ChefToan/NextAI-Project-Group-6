"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REPORT_DEFINITIONS, type ReportType } from "@/lib/report-definitions";

type ReportResult = {
  filename: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
  generatedAt: string;
  unavailableReason?: string;
  error?: string;
};

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

function downloadCsv(result: ReportResult) {
  const rows = [result.columns, ...result.rows.map((row) => result.columns.map((column) => row[column] ?? ""))];
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function GenerateReportButton({ range, label = "Generate report" }: Props) {
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>("dailyUsage");
  const [fields, setFields] = useState<string[]>(REPORT_DEFINITIONS[0].defaultFields);
  const [filters, setFilters] = useState({ accountId: "", model: "", product: "", glId: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");
  const [glMeta, setGlMeta] = useState<{ loaded: boolean; available: boolean; reason?: string }>({ loaded: false, available: true });
  const [mounted, setMounted] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Bring the preview into view once it renders — it can sit below the fold when
  // many fields are selected.
  useEffect(() => {
    if (result && !result.unavailableReason) {
      previewRef.current?.scrollIntoView({ block: "start" });
    }
  }, [result]);

  const definition = useMemo(
    () => REPORT_DEFINITIONS.find((candidate) => candidate.id === reportType) ?? REPORT_DEFINITIONS[0],
    [reportType],
  );

  const columnLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of definition.fields) map[field.id] = field.label;
    return map;
  }, [definition]);

  const PREVIEW_LIMIT = 50;

  useEffect(() => {
    setFields(definition.defaultFields);
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

  function toggleField(field: string) {
    setFields((current) => {
      if (current.includes(field)) return current.length === 1 ? current : current.filter((candidate) => candidate !== field);
      return [...current, field];
    });
    setResult(null);
  }

  async function generate() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/group6/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType, fields, range, filters }),
      });
      const data = (await response.json()) as ReportResult;
      if (!response.ok) throw new Error(data.error || "Unable to generate report.");
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <span className="ms">fact_check</span>
        {label}
      </button>

      {open && mounted
        ? createPortal(
        <div className="report-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-builder-title">
            <div className="report-modal-head">
              <div>
                <div className="eyebrow">Report builder</div>
                <h2 id="report-builder-title">Generate report</h2>
                <p>Choose a preset, select fields, preview the report, then download a CSV.</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Close report builder" onClick={() => setOpen(false)}>
                <span className="ms">close</span>
              </button>
            </div>

            <div className="report-builder-grid">
              <aside className="report-preset-list" aria-label="Report presets">
                {REPORT_DEFINITIONS.map((preset) => {
                  const disabled = preset.id === "glLookup" && glMeta.loaded && !glMeta.available;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      className={`report-preset ${preset.id === reportType ? "is-active" : ""}`}
                      disabled={disabled}
                      onClick={() => setReportType(preset.id)}
                    >
                      <span>{preset.label}</span>
                      <small>{disabled ? glMeta.reason : preset.description}</small>
                    </button>
                  );
                })}
              </aside>

              <div className="report-builder-main">
                <div className="report-card">
                  <div className="report-card-head">
                    <div>
                      <h3>{definition.label}</h3>
                      <p>{definition.description}</p>
                    </div>
                    <span className="pill">{fields.length} fields</span>
                  </div>

                  <div className="report-field-grid">
                    {definition.fields.map((field) => (
                      <label className="report-field" key={field.id}>
                        <input type="checkbox" checked={fields.includes(field.id)} onChange={() => toggleField(field.id)} />
                        <span>
                          <strong>{field.label}</strong>
                          <small>{field.group}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="report-card">
                  <div className="report-card-head">
                    <div>
                      <h3>Filters</h3>
                      <p>The current report date range is used automatically.</p>
                    </div>
                    <span className="pill">{range?.label ?? "Current range"}</span>
                  </div>
                  <div className="report-filter-grid">
                    <label>
                      <span>Account ID</span>
                      <input value={filters.accountId} onChange={(event) => setFilters({ ...filters, accountId: event.target.value })} placeholder="Optional" />
                    </label>
                    <label>
                      <span>Model</span>
                      <input value={filters.model} onChange={(event) => setFilters({ ...filters, model: event.target.value })} placeholder="3.0 or 3.5" />
                    </label>
                    <label>
                      <span>Product</span>
                      <input value={filters.product} onChange={(event) => setFilters({ ...filters, product: event.target.value })} placeholder="Optional" />
                    </label>
                    <label>
                      <span>GL ID</span>
                      <input value={filters.glId} onChange={(event) => setFilters({ ...filters, glId: event.target.value })} placeholder="GL lookup only" />
                    </label>
                  </div>
                </div>

                {error ? <div className="report-error">{error}</div> : null}
                {result?.unavailableReason ? <div className="report-error">{result.unavailableReason}</div> : null}

                {result && !result.unavailableReason ? (
                  <div className="report-card report-preview-card" ref={previewRef}>
                    <div className="report-card-head">
                      <div>
                        <h3>Preview</h3>
                        <p>
                          {result.rows.length.toLocaleString()} rows · {result.columns.length} fields ·{" "}
                          <span className="mono">{result.filename}</span>
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
                        <table className="report-preview-table">
                          <thead>
                            <tr>
                              {result.columns.map((column) => (
                                <th key={column} scope="col">{columnLabels[column] ?? column}</th>
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
                <button type="button" className="btn" onClick={generate} disabled={loading}>
                  <span className="ms">preview</span>
                  {loading ? "Generating..." : "Preview report"}
                </button>
                <button type="button" className="btn btn-primary" disabled={!result || Boolean(result.unavailableReason) || result.rows.length === 0} onClick={() => result && downloadCsv(result)}>
                  <span className="ms">download</span>
                  Download CSV
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