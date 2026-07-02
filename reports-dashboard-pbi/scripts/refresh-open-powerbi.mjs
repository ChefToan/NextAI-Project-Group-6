import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(WORKSPACE_ROOT, "..");
const REPORT_PATH = path.join(
  WORKSPACE_ROOT,
  "report",
  "NextAIGroup6.Report",
  "NextAI Group 6 Billing.Report",
);
const DAX_DIR = path.join(WORKSPACE_ROOT, "model", "dax");

const TABLES = [
  "fact_group6_usage_daily",
  "fact_group6_finance_monthly",
  "fact_group6_customer_bills",
  "dim_group6_account_service",
  "fact_group6_sanity_checks",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    encoding: "utf8",
    shell: false,
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!options.quiet && out) console.log(out);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return out;
}

function runJson(command, args) {
  const out = run(command, args, { quiet: true });
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}, got:\n${out}`);
  }
}

function metric(row, key) {
  const raw = row?.[key];
  const value = Number(String(raw ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(value) ? value : null;
}

async function main() {
  const shouldExport = process.argv.includes("--export");

  if (shouldExport) {
    console.log("Exporting fresh OCI data to CSV...");
    run(process.execPath, [path.join(WORKSPACE_ROOT, "scripts", "export-group6-powerbi.mjs")], { cwd: PROJECT_ROOT });
  }

  console.log("Connecting to the open Power BI Desktop instance...");
  run("pbi", ["disconnect"], { allowFailure: true, quiet: true });
  run("pbi", ["connect"]);

  console.log("Refreshing imported tables...");
  for (const table of TABLES) {
    run("pbi", ["table", "refresh", table, "--type", "Full"]);
  }

  const partition = runJson("pbi", ["--json", "partition", "list", "--table", "fact_group6_usage_daily"]);
  const factState = partition.find((p) => p.name === "fact_group6_usage_daily")?.state;
  if (factState !== "Ready") {
    throw new Error(`fact_group6_usage_daily partition is ${factState ?? "missing"}, expected Ready`);
  }

  const rows = runJson("pbi", ["--json", "dax", "execute", "--file", path.join(DAX_DIR, "row-count-check.dax")]);
  const row = rows.rows?.[0];
  const factRows = metric(row, "[Fact Rows]");
  const financeRows = metric(row, "[Finance Rows]");
  const customerBillRows = metric(row, "[Customer Bill Rows]");
  const dimRows = metric(row, "[Dim Rows]");
  const checkRows = metric(row, "[Check Rows]");
  if (!factRows || !financeRows || !customerBillRows || !dimRows || checkRows !== 3) {
    throw new Error(
      `Unexpected row counts: fact=${factRows}, finance=${financeRows}, customerBills=${customerBillRows}, dim=${dimRows}, checks=${checkRows}`,
    );
  }

  const sanity = runJson("pbi", ["--json", "dax", "execute", "--file", path.join(DAX_DIR, "sanity-check.dax")]);
  const sanityRow = sanity.rows?.[0];
  const usageEvents = metric(sanityRow, "[Usage Events]");
  const usageRevenue = metric(sanityRow, "[Usage Revenue USD]");
  const activeAccounts = metric(sanityRow, "[Active Accounts]");
  if (!usageEvents || usageRevenue == null || !activeAccounts) {
    throw new Error(
      `Unexpected KPI totals: usageEvents=${usageEvents}, usageRevenue=${usageRevenue}, activeAccounts=${activeAccounts}`,
    );
  }

  run("pbi", ["report", "-p", REPORT_PATH, "validate", "--full"]);

  console.log("Reloading Power BI report canvas...");
  run("pbi", ["report", "-p", REPORT_PATH, "reload"], { allowFailure: true });

  console.log(
    [
      "Power BI refresh verified.",
      `Fact rows: ${factRows.toLocaleString()}`,
      `Finance rows: ${financeRows.toLocaleString()}`,
      `Customer bill rows: ${customerBillRows.toLocaleString()}`,
      `Dim rows: ${dimRows.toLocaleString()}`,
      `Usage events: ${usageEvents.toLocaleString()}`,
      `Usage revenue: $${usageRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Active accounts: ${activeAccounts.toLocaleString()}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
