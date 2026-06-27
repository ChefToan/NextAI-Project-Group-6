"use client";

export function ExportCsvButton({
  rows,
  filename,
  label = "Export CSV",
}: {
  rows: (string | number)[][];
  filename: string;
  label?: string;
}) {
  function download() {
    const csv = rows
      .map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button className="btn" onClick={download} type="button">
      <span className="ms">download</span>
      {label}
    </button>
  );
}
